export interface PiPackage {
  source: string;
  enabled: boolean;
  installed: boolean;
  skills: number;
  extensions: number;
  prompts: number;
}

export interface PiSkill {
  name: string;
  description: string;
  source: string;
  command: string;
}

export interface PiResourceCatalog {
  packages: PiPackage[];
  skills: PiSkill[];
  extensions: { name: string; source: string }[];
  prompts: { name: string; source: string }[];
  diagnostics: { message: string; path?: string }[];
}

export type PiPackageAction = 'install' | 'enable' | 'disable' | 'remove' | 'update';
