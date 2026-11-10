import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publishFiles, type PublishHooks } from "./publish.js";

describe("publishFiles", () => {
  it("leaves the previous pair when the second write fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-publish-"));
    const day0 = path.join(dir, "day0.json");
    const day1 = path.join(dir, "day1.json");
    fs.writeFileSync(day0, "old-day0");
    fs.writeFileSync(day1, "old-day1");
    let writes = 0;
    const hooks = fileHooks({
      writeFile: (file, contents) => {
        writes += 1;
        if (writes === 2) throw new Error("disk full");
        fs.writeFileSync(file, contents);
      },
    });

    expect(() =>
      publishFiles(
        [
          { path: day0, contents: "new-day0" },
          { path: day1, contents: "new-day1" },
        ],
        hooks,
      ),
    ).toThrow("disk full");
    expect(fs.readFileSync(day0, "utf8")).toBe("old-day0");
    expect(fs.readFileSync(day1, "utf8")).toBe("old-day1");
    expect(fs.readdirSync(dir).sort()).toEqual(["day0.json", "day1.json"]);
  });

  it("leaves the previous report files when the second write fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-publish-"));
    const names = ["day0.csv", "day0.json", "day1.csv", "day1.json"];
    const files = names.map((name) => path.join(dir, name));
    for (const file of files) fs.writeFileSync(file, `old ${path.basename(file)}`);
    let writes = 0;
    expect(() =>
      publishFiles(
        files.map((file) => ({ path: file, contents: `new ${path.basename(file)}` })),
        fileHooks({
          writeFile: (file, contents) => {
            writes += 1;
            if (writes === 2) throw new Error("disk full");
            fs.writeFileSync(file, contents);
          },
        }),
      ),
    ).toThrow("disk full");
    expect(files.map((file) => fs.readFileSync(file, "utf8"))).toEqual(names.map((name) => `old ${name}`));
  });

  it("renames both files after both writes succeed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-publish-"));
    const day0 = path.join(dir, "rules", "day0.json");
    const day1 = path.join(dir, "rules", "day1.json");
    fs.mkdirSync(path.dirname(day0), { recursive: true });
    fs.writeFileSync(day0, "old-day0");
    fs.writeFileSync(day1, "old-day1");
    publishFiles([
      { path: day0, contents: "new-day0" },
      { path: day1, contents: "new-day1" },
    ]);
    expect(fs.readFileSync(day0, "utf8")).toBe("new-day0");
    expect(fs.readFileSync(day1, "utf8")).toBe("new-day1");
  });
});

function fileHooks(over: Partial<PublishHooks>): PublishHooks {
  return {
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
    ...over,
  };
}
