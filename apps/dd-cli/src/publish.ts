import fs from "node:fs";
import path from "node:path";

export type PublishHooks = {
  mkdir: (dir: string) => void;
  writeFile: (file: string, contents: string) => void;
  rename: (from: string, to: string) => void;
  exists: (file: string) => boolean;
  remove: (file: string) => void;
};

const fsHooks: PublishHooks = {
  mkdir: (dir) => {
    fs.mkdirSync(dir, { recursive: true });
  },
  writeFile: (file, contents) => {
    fs.writeFileSync(file, contents);
  },
  rename: (from, to) => {
    fs.renameSync(from, to);
  },
  exists: (file) => fs.existsSync(file),
  remove: (file) => {
    fs.rmSync(file, { force: true });
  },
};

/**
 * Write every file to a temp name first. Rename into place only after every temp write succeeds.
 * A failure on a later write leaves the previous files untouched.
 * A failure while renaming rolls the published names back to the previous bytes.
 */
export function publishFiles(files: readonly { path: string; contents: string }[], hooks: PublishHooks = fsHooks): void {
  const staged = files.map((file, index) => ({
    ...file,
    temp: `${file.path}.${process.pid}.${index}.tmp`,
    backup: `${file.path}.${process.pid}.${index}.bak`,
  }));
  try {
    for (const file of staged) {
      hooks.mkdir(path.dirname(file.path));
      hooks.writeFile(file.temp, file.contents);
    }
  } catch (error) {
    for (const file of staged) {
      if (hooks.exists(file.temp)) hooks.remove(file.temp);
    }
    throw error;
  }

  const placed: { path: string; backup: string | null }[] = [];
  try {
    for (const file of staged) {
      const had = hooks.exists(file.path);
      if (had) hooks.rename(file.path, file.backup);
      placed.push({ path: file.path, backup: had ? file.backup : null });
      hooks.rename(file.temp, file.path);
    }
  } catch (error) {
    for (const item of placed.reverse()) {
      if (hooks.exists(item.path)) hooks.remove(item.path);
      if (item.backup !== null && hooks.exists(item.backup)) hooks.rename(item.backup, item.path);
    }
    for (const file of staged) {
      if (hooks.exists(file.temp)) hooks.remove(file.temp);
    }
    throw error;
  }
  for (const item of placed) {
    if (item.backup !== null && hooks.exists(item.backup)) hooks.remove(item.backup);
  }
}
