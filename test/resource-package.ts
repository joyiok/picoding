import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Local synthetic package using the unmodified, documented Pi package layout. */
export async function resourcePackage(directory: string) {
  const root = join(directory, 'native-pi-fixture');
  for (const path of ['skills/fixture-skill/scripts', 'prompts', 'dynamic']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'picoding-local-test-package', pi: { skills: ['./skills'], extensions: ['./extension.ts'], prompts: ['./prompts'] } }));
  await writeFile(join(root, 'skills/fixture-skill/SKILL.md'), '---\nname: fixture-skill\ndescription: 本地测试技能（模拟数据），验证 pi 原生按需加载与沙盒脚本。\n---\n\nNATIVE_SKILL_BODY. Run scripts/check.py with Python in the project workspace.');
  await writeFile(join(root, 'skills/fixture-skill/scripts/check.py'), 'from pathlib import Path\nPath("native-helper.txt").write_text("NATIVE_HELPER_OK")\nprint("NATIVE_HELPER_OK")\n');
  await writeFile(join(root, 'dynamic/SKILL.md'), '---\nname: dynamic-fixture\ndescription: 模拟扩展通过 resources_discover 注册的技能。\n---\n\nDYNAMIC_SKILL_BODY.');
  await writeFile(join(root, 'prompts/fixture-review.md'), 'NATIVE_PROMPT_BODY: review $ARGUMENTS');
  await writeFile(join(root, 'extension.ts'), `import { Type } from 'typebox';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export default function (pi) {
  pi.registerTool({ name: 'fixture_ping', label: '本地测试扩展', description: 'Return the supplied fixture word.', parameters: Type.Object({ word: Type.String() }),
    execute: async (_id, args) => ({ content: [{ type: 'text', text: 'NATIVE_EXTENSION_OK:' + args.word }], details: {} }) });
  pi.registerCommand('fixture-echo', { description: '本地测试命令', handler: async args => { pi.sendMessage({ customType: 'fixture-echo', content: 'NATIVE_COMMAND_OK:' + args, display: true }); } });
  pi.on('resources_discover', () => ({ skillPaths: [join(dirname(fileURLToPath(import.meta.url)), 'dynamic')] }));
}
`);
  return root;
}
