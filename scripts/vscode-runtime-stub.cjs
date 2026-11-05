const path = require('node:path')
const Module = require('node:module')

const uriFromPath = (fsPath) => ({
  fsPath,
  path: fsPath,
  scheme: 'file',
  toString: () => `file://${String(fsPath).replace(/\\/g, '/')}`,
})

const config = {
  get: (_key, fallback) => fallback,
  update: async () => undefined,
}

const vscodeStub = {
  commands: {
    executeCommand: async () => undefined,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  env: {
    appRoot: '',
    language: 'en',
    openExternal: async () => undefined,
    uiKind: 1,
  },
  ExtensionMode: {
    Development: 2,
    Production: 1,
    Test: 3,
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id
    }
  },
  Uri: {
    file: uriFromPath,
    joinPath: (base, ...parts) => uriFromPath(path.join(base?.fsPath || base?.path || '', ...parts)),
  },
  ViewColumn: {
    Active: 1,
  },
  window: {
    activeColorTheme: { kind: 1 },
    createOutputChannel: () => ({
      append() {},
      appendLine() {},
      clear() {},
      dispose() {},
      show() {},
    }),
    createStatusBarItem: () => ({
      command: '',
      dispose() {},
      hide() {},
      show() {},
      text: '',
    }),
    onDidChangeActiveColorTheme: () => ({ dispose() {} }),
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showTextDocument: async () => undefined,
    showWarningMessage: async () => undefined,
  },
  workspace: {
    fs: {
      copy: async () => undefined,
      delete: async () => undefined,
      rename: async () => undefined,
    },
    getConfiguration: () => config,
    openTextDocument: async () => undefined,
    workspaceFolders: [],
  },
}

const originalLoad = Module._load

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub
  }
  return originalLoad.call(this, request, parent, isMain)
}
