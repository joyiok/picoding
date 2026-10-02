import { existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import {
  DefaultPackageManager, loadSkills, SettingsManager,
  type PackageSource, type Skill,
} from '@earendil-works/pi-coding-agent';
import type { PiPackageAction, PiResourceCatalog } from '../shared/resources.js';
import { config } from './config.js';
import { errorMessage, HttpError, requireString } from './http.js';

const sourceOf = (value: PackageSource) => typeof value === 'string' ? value : value.source;
const disabled = (value: PackageSource) => typeof value !== 'string' && ['extensions', 'skills', 'prompts', 'themes'].every(key => {
  const patterns = value[key as keyof typeof value]; return Array.isArray(patterns) ? patterns.length === 0 : patterns === undefined && value.autoload === false;
});
type ResolvedPaths = Awaited<ReturnType<DefaultPackageManager['resolve']>>;

/** Pi owns the package format, installation, settings and resource discovery. */
export class PiResources {
  readonly agentDir: string;
  readonly cwd: string;
  private changing = false;
  constructor(directory = config.dataDir) {
    this.agentDir = join(resolve(directory), 'pi');
    this.cwd = join(resolve(directory), 'pi-workspace');
  }

  private manager() {
    mkdirSync(this.agentDir, { recursive: true, mode: 0o700 });
    mkdirSync(this.cwd, { recursive: true, mode: 0o700 });
    const settings = SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: false });
    const errors = settings.drainErrors();
    if (errors.length) throw new HttpError(500, `无法读取 pi 配置：${errors[0].error.message}`);
    settings.applyOverrides({ enableInstallTelemetry: false, enableAnalytics: false });
    return { settings, packages: new DefaultPackageManager({ cwd: this.cwd, agentDir: this.agentDir, settingsManager: settings }) };
  }

  private scoped(paths: ResolvedPaths): ResolvedPaths {
    const allowed = (item: ResolvedPaths['skills'][number]) => item.metadata.scope === 'user' && (item.metadata.origin === 'package' || item.metadata.source !== 'auto' || item.path.startsWith(this.agentDir + sep));
    // Pi also discovers ~/.agents/skills. The workbench uses only its own Pi scope
    // and sources explicitly configured by its user, rather than the host assistant's skills.
    return { skills: paths.skills.filter(allowed), extensions: paths.extensions.filter(allowed), prompts: paths.prompts.filter(allowed), themes: paths.themes.filter(allowed) };
  }

  async snapshot() {
    const { settings, packages } = this.manager();
    // Listing/session startup never implicitly installs an unconfigured or missing source.
    const paths = this.scoped(await packages.resolve(async () => 'skip'));
    const skills = loadSkills({ cwd: this.cwd, agentDir: this.agentDir, includeDefaults: false, skillPaths: paths.skills.filter(item => item.enabled).map(item => item.path) });
    return { paths, skills, settings: settings.getSettings() };
  }

  async catalog(): Promise<PiResourceCatalog> {
    const current = await this.snapshot();
    const declarations = current.settings.packages || [];
    // Ask Pi for the inventory even when a package's resource filters disable it.
    const inventorySettings = SettingsManager.inMemory({ ...current.settings, packages: declarations.map(sourceOf) });
    const inventory = new DefaultPackageManager({ cwd: this.cwd, agentDir: this.agentDir, settingsManager: inventorySettings });
    const all = this.scoped(await inventory.resolve(async () => 'skip'));
    const allSkills = loadSkills({ cwd: this.cwd, agentDir: this.agentDir, includeDefaults: false, skillPaths: all.skills.filter(item => item.enabled).map(item => item.path) });
    const source = (skill: Skill) => current.paths.skills.find(item => skill.filePath === item.path || skill.filePath.startsWith(item.path + sep))?.metadata.source || '本地 skills';
    return {
      packages: declarations.map(value => {
        const source = sourceOf(value);
        const root = inventory.getInstalledPath(source, 'user');
        const belongs = (path: string) => root && (path === root || path.startsWith(root + sep));
        return { source, enabled: !disabled(value), installed: Boolean(root && existsSync(root)), skills: allSkills.skills.filter(skill => belongs(skill.filePath)).length, extensions: all.extensions.filter(item => belongs(item.path)).length, prompts: all.prompts.filter(item => belongs(item.path)).length };
      }),
      skills: current.skills.skills.map(skill => ({ name: skill.name, description: skill.description, source: source(skill), command: `/skill:${skill.name}` })),
      extensions: current.paths.extensions.filter(item => item.enabled).map(item => ({ name: basename(item.path), source: item.metadata.source })),
      prompts: current.paths.prompts.filter(item => item.enabled).map(item => ({ name: basename(item.path, '.md'), source: item.metadata.source })),
      diagnostics: current.skills.diagnostics.map(item => ({ message: item.message, path: item.path })),
    };
  }

  async change(action: PiPackageAction, input: unknown) {
    if (!['install', 'enable', 'disable', 'remove', 'update'].includes(action)) throw new HttpError(400, '请选择安装、启用、停用、移除或更新');
    const source = requireString(input, 'pi 包来源', 2048).trim();
    if (/[\r\n\0]/.test(source) || source.startsWith('-')) throw new HttpError(400, 'pi 包来源无效');
    if (this.changing) throw new HttpError(409, 'pi 包操作正在进行，请稍后重试');
    this.changing = true;
    try {
      const { settings, packages } = this.manager();
      const declarations = settings.getPackages();
      if (action !== 'install' && !declarations.some(item => sourceOf(item) === source)) throw new HttpError(404, '这个 pi 包尚未安装');
      if (action === 'install') await packages.installAndPersist(source);
      else if (action === 'remove') await packages.removeAndPersist(source);
      else if (action === 'update') await packages.update(source);
      else settings.setPackages(declarations.map(item => sourceOf(item) !== source ? item : action === 'enable' ? source : { source, extensions: [], skills: [], prompts: [], themes: [] }));
      await settings.flush();
      const errors = settings.drainErrors();
      if (errors.length) throw errors[0].error;
      return await this.catalog();
    } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, `pi 包操作未完成：${errorMessage(error)}`); }
    finally { this.changing = false; }
  }
}
