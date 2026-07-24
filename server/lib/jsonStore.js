import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  resolve(relativePath) {
    const absolutePath = path.resolve(this.rootDir, relativePath);
    if (!absolutePath.startsWith(this.rootDir + path.sep) && absolutePath !== this.rootDir) {
      throw new Error(`Path escapes store root: ${relativePath}`);
    }
    return absolutePath;
  }

  async read(relativePath, fallbackValue) {
    try {
      const filePath = this.resolve(relativePath);
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(fallbackValue);
      throw error;
    }
  }

  async write(relativePath, value) {
    const filePath = this.resolve(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    const body = `${JSON.stringify(value, null, 2)}\n`;
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, body, 'utf8');
    await rename(tmpPath, filePath);
    return value;
  }

  async list(relativeDir) {
    try {
      const dirPath = this.resolve(relativeDir);
      return await readdir(dirPath);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async remove(relativePath) {
    try {
      await rm(this.resolve(relativePath));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
}
