// Version history store — external to Proxy constraints
const appVersions = new WeakMap();

class Component extends BaseClassX {
  static _schema = {
    type: 'component',
    properties: {
      controlType: { type: 'string', default: 'label' },
      left: { type: 'number', default: 0 },
      top: { type: 'number', default: 0 },
      width: { type: 'number', default: 100 },
      height: { type: 'number', default: 30 },
      caption: { type: 'string', default: '' },
      text: { type: 'string', default: '' },
      checked: { type: 'boolean', default: false },
      items: { type: 'array', default: [] },
      columns: { type: 'array', default: [] },
      rows: { type: 'array', default: [] }
    }
  };

  constructor(options = {}) {
    super({
      type: 'Component',
      ...options
    });
  }
}

class Form extends BaseClassX {
  static _schema = {
    type: 'form',
    properties: {
      formName: { type: 'string', default: 'Form1' },
      moduleId: { type: 'string', default: '' },
      formClassCode: { type: 'string', default: '' },
      components: { type: 'array', default: [] }
    }
  };

  constructor(options = {}) {
    super({
      type: 'Form',
      components: options.components || [],
      ...options
    });
  }

  addComponent(comp) {
    if (!(comp instanceof Component)) throw new Error('Child must be a Component');
    this.components.push(comp);
    this.addChild(comp);
    this.emit('component_added', { componentId: comp.id });
    return this;
  }

  removeComponent(comp) {
    const idx = this.components.indexOf(comp);
    if (idx !== -1) {
      this.components.splice(idx, 1);
      this.removeChild(comp);
      this.emit('component_removed', { componentId: comp.id });
    }
    return this;
  }

  getComponents() {
    return this.components;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      formName: this.formName,
      moduleId: this.moduleId,
      formClassCode: this.formClassCode,
      components: this.components.map(c => ({
        id: c.id,
        controlType: c.controlType,
        left: c.left,
        top: c.top,
        width: c.width,
        height: c.height,
        caption: c.caption,
        text: c.text,
        checked: c.checked,
        items: c.items,
        columns: c.columns,
        rows: c.rows
      }))
    };
  }

  static fromJSON(data) {
    const form = new Form({
      id: data.id,
      name: data.name,
      formName: data.formName,
      moduleId: data.moduleId,
      formClassCode: data.formClassCode
    });
    if (data.components) {
      for (const cd of data.components) {
        const comp = new Component({
          id: cd.id,
          controlType: cd.controlType,
          left: cd.left,
          top: cd.top,
          width: cd.width,
          height: cd.height,
          caption: cd.caption,
          text: cd.text,
          checked: cd.checked,
          items: cd.items,
          columns: cd.columns,
          rows: cd.rows
        });
        form.addComponent(comp);
      }
    }
    return form;
  }
}

class Module extends BaseClassX {
  static _schema = {
    type: 'module',
    properties: {
      moduleName: { type: 'string', default: 'Module1' },
      appId: { type: 'string', default: '' },
      forms: { type: 'array', default: [] }
    }
  };

  constructor(options = {}) {
    super({
      type: 'Module',
      forms: options.forms || [],
      ...options
    });
  }

  addForm(form) {
    if (!(form instanceof Form)) throw new Error('Child must be a Form');
    this.forms.push(form);
    this.addChild(form);
    this.emit('form_added', { formId: form.id });
    return this;
  }

  removeForm(form) {
    const idx = this.forms.indexOf(form);
    if (idx !== -1) {
      this.forms.splice(idx, 1);
      this.removeChild(form);
      this.emit('form_removed', { formId: form.id });
    }
    return this;
  }

  getForms() {
    return this.forms;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      moduleName: this.moduleName,
      appId: this.appId,
      forms: this.forms.map(f => f.toJSON())
    };
  }

  static fromJSON(data) {
    const mod = new Module({
      id: data.id,
      name: data.name,
      moduleName: data.moduleName,
      appId: data.appId
    });
    if (data.forms) {
      for (const fd of data.forms) {
        mod.addForm(Form.fromJSON(fd));
      }
    }
    return mod;
  }
}

class App extends BaseClassX {
  static _schema = {
    type: 'app',
    properties: {
      projectName: { type: 'string', default: 'Project' },
      versionNumber: { type: 'number', default: 1 },
      schemaVersion: { type: 'string', default: '2.2.06' },
      modules: { type: 'array', default: [] }
    }
  };

  constructor(options = {}) {
    super({
      type: 'App',
      projectName: options.projectName || 'Project',
      versionNumber: options.versionNumber || 1,
      schemaVersion: options.schemaVersion || '2.2.06',
      modules: options.modules || [],
      ...options
    });
    appVersions.set(this, options._versions || []);
  }

  addModule(mod) {
    if (!(mod instanceof Module)) throw new Error('Child must be a Module');
    this.modules.push(mod);
    this.addChild(mod);
    this.emit('module_added', { moduleId: mod.id });
    return this;
  }

  removeModule(mod) {
    const idx = this.modules.indexOf(mod);
    if (idx !== -1) {
      this.modules.splice(idx, 1);
      this.removeChild(mod);
      this.emit('module_removed', { moduleId: mod.id });
    }
    return this;
  }

  getModules() {
    return this.modules;
  }

  saveVersion() {
    const snapshot = {
      versionNumber: this.versionNumber,
      timestamp: Date.now(),
      state: this.toJSON()
    };
    const versions = appVersions.get(this);
    versions.push(snapshot);
    this.versionNumber++;
    this._recordTrace('version_saved', { versionNumber: snapshot.versionNumber });
    this.emit('version_saved', { version: snapshot });
    return snapshot;
  }

  getVersions() {
    return appVersions.get(this) || [];
  }

  restoreVersion(versionNumber) {
    const versions = appVersions.get(this);
    const snapshot = versions.find(v => v.versionNumber === versionNumber);
    if (!snapshot) throw new Error(`Version ${versionNumber} not found`);
    const restored = App.fromJSON(snapshot.state);
    this.modules = restored.modules;
    this._recordTrace('version_restored', { versionNumber });
    this.emit('version_restored', { versionNumber });
    return restored;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      projectName: this.projectName,
      versionNumber: this.versionNumber,
      schemaVersion: this.schemaVersion,
      created: this.created,
      modified: this.modified,
      modules: this.modules.map(m => m.toJSON())
    };
  }

  static fromJSON(data) {
    const app = new App({
      id: data.id,
      projectName: data.projectName,
      versionNumber: data.versionNumber,
      schemaVersion: data.schemaVersion,
      created: data.created,
      modified: data.modified
    });
    if (data.modules) {
      for (const md of data.modules) {
        app.addModule(Module.fromJSON(md));
      }
    }
    return app;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { App, Module, Form, Component };
}
