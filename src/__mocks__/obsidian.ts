// Minimal mock for the obsidian module so vitest can resolve imports.
export class App {}
export class Modal {}
export class PluginSettingTab {}
export class Setting {}
export class Plugin {}
export class Notice {}
export function requestUrl() { return Promise.resolve({ json: {}, status: 200 }); }
export type RequestUrlParam = Record<string, unknown>;
