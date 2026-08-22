/**
 * @file SchemaDB.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description The declared-type layer over raw storage (DBX's IndexedDB
 *              object stores, SQLite tables, or a FlowEntity's properties
 *              bag) — DATA, not classes, same convention as
 *              FlowTypeRegistry.js. Registering a table/store's schema here
 *              means DBX can render typed grids (real dropdowns for enums,
 *              real date pickers, correct number formatting) instead of
 *              stringifying every cell, and Flow can validate a node's
 *              fields against a real declared contract instead of trusting
 *              whatever JSON happened to show up.
 *
 *              Basic types: string, int, float, bool, date, datetime.
 *              Complex types: json (arbitrary object/array), enum (closed
 *              option list), ref (foreign-key-style pointer to another
 *              schema's records), array (typed list of a basic/complex
 *              type).
 *
 *              Each field also carries metadata (description, unit,
 *              sensitivity) and an optional FieldACL for real per-field
 *              access control — the same FieldACL already used on
 *              BaseClassX schemas, so a DBX/Flow field can be gated the
 *              identical way a class field already is.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require('./FieldACL.js') : root.FieldACL);
  else root.SchemaDB = factory(root.FieldACL);
}(typeof self !== 'undefined' ? self : this, function(FieldACL) {
  'use strict';

  const BASIC_TYPES = ['string', 'int', 'float', 'bool', 'date', 'datetime'];
  // 'set': a fixed option list where MULTIPLE options can be selected at once (MySQL SET
  // semantics) — distinct from 'enum' (exactly one). Natural fit for permission bits, feature
  // flags, POSIX-style mode flags: stored/queried as an array of selected option strings.
  const COMPLEX_TYPES = ['json', 'enum', 'set', 'ref', 'array'];
  const ALL_TYPES = BASIC_TYPES.concat(COMPLEX_TYPES);

  // schemaKey -> { label, source: {kind, ref}, fields: [{name, type, ...}], metadata }
  const SCHEMAS = {};

  function validateFieldDef(f) {
    if (!f.name) throw new Error('SchemaDB: field missing name');
    if (!ALL_TYPES.includes(f.type)) throw new Error(`SchemaDB: unknown type "${f.type}" on field "${f.name}"`);
    if ((f.type === 'enum' || f.type === 'set') && (!Array.isArray(f.options) || !f.options.length)) {
      throw new Error(`SchemaDB: ${f.type} field "${f.name}" requires a non-empty options[]`);
    }
    if (f.type === 'ref' && !f.refSchema) {
      throw new Error(`SchemaDB: ref field "${f.name}" requires refSchema (target schema key)`);
    }
    if (f.type === 'array' && !f.itemType) {
      throw new Error(`SchemaDB: array field "${f.name}" requires itemType`);
    }
  }

  /**
   * source describes where the schema applies: { kind: 'idb'|'sqlite'|'flowEntity'|'custom', ref: <db/table/entityType name> }
   * fields: [{ name, type, required, description, unit, sensitivity, options (enum), refSchema (ref), itemType (array), acl (FieldACL instance or FieldACL.build() opts) }]
   */
  function registerSchema(key, { label, source, fields, metadata } = {}) {
    (fields || []).forEach(validateFieldDef);
    const normalizedFields = (fields || []).map(f => ({
      name: f.name,
      type: f.type,
      required: !!f.required,
      description: f.description || '',
      unit: f.unit || null,
      sensitivity: f.sensitivity || 'normal', // 'normal' | 'pii' | 'financial' | 'secret'
      options: (f.type === 'enum' || f.type === 'set') ? f.options.slice() : undefined,
      refSchema: f.type === 'ref' ? f.refSchema : undefined,
      itemType: f.type === 'array' ? f.itemType : undefined,
      acl: f.acl instanceof FieldACL ? f.acl : (f.acl ? FieldACL.build(f.acl) : null)
    }));
    SCHEMAS[key] = { label: label || key, source: source || null, fields: normalizedFields, metadata: metadata || {} };
    return SCHEMAS[key];
  }

  function getSchema(key) { return SCHEMAS[key] || null; }
  function listSchemas() { return Object.entries(SCHEMAS).map(([key, def]) => ({ schemaKey: key, ...def })); }
  function getField(key, fieldName) {
    const s = SCHEMAS[key];
    if (!s) return null;
    return s.fields.find(f => f.name === fieldName) || null;
  }

  /** Coerce a raw stored value to its declared type's display/edit-friendly form. Never throws — falls back to the raw value on mismatch. */
  function coerce(fieldDef, rawValue) {
    if (rawValue === null || rawValue === undefined) return rawValue;
    try {
      switch (fieldDef.type) {
        case 'int': return parseInt(rawValue, 10);
        case 'float': return parseFloat(rawValue);
        case 'bool': return typeof rawValue === 'boolean' ? rawValue : (rawValue === 'true' || rawValue === 1 || rawValue === '1');
        case 'date': case 'datetime': return rawValue instanceof Date ? rawValue : new Date(rawValue);
        case 'json': return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        case 'array': return Array.isArray(rawValue) ? rawValue : (typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue);
        case 'set': return Array.isArray(rawValue) ? rawValue : (typeof rawValue === 'string' ? rawValue.split(',').map(s => s.trim()).filter(Boolean) : rawValue);
        default: return rawValue;
      }
    } catch (e) { return rawValue; }
  }

  /** Validate a single value against its field definition. Returns {ok, error}. */
  function validateValue(fieldDef, value) {
    if (value === null || value === undefined || value === '') {
      return fieldDef.required ? { ok: false, error: `"${fieldDef.name}" is required` } : { ok: true };
    }
    switch (fieldDef.type) {
      case 'int': return Number.isInteger(coerce(fieldDef, value)) ? { ok: true } : { ok: false, error: `"${fieldDef.name}" must be an integer` };
      case 'float': return !isNaN(coerce(fieldDef, value)) ? { ok: true } : { ok: false, error: `"${fieldDef.name}" must be a number` };
      case 'bool': return { ok: true };
      case 'date': case 'datetime': return !isNaN(new Date(value).getTime()) ? { ok: true } : { ok: false, error: `"${fieldDef.name}" must be a valid date` };
      case 'enum': return fieldDef.options.includes(value) ? { ok: true } : { ok: false, error: `"${fieldDef.name}" must be one of: ${fieldDef.options.join(', ')}` };
      case 'set': {
        const vals = coerce(fieldDef, value);
        const bad = (Array.isArray(vals) ? vals : []).filter(v => !fieldDef.options.includes(v));
        return bad.length ? { ok: false, error: `"${fieldDef.name}" has invalid option(s): ${bad.join(', ')} — allowed: ${fieldDef.options.join(', ')}` } : { ok: true };
      }
      case 'json': case 'array':
        try { coerce(fieldDef, value); return { ok: true }; } catch (e) { return { ok: false, error: `"${fieldDef.name}" must be valid ${fieldDef.type}` }; }
      default: return { ok: true };
    }
  }

  /** Validate a whole record against a schema. Returns {ok, errors: [{field, error}]}. */
  function validateRecord(key, record) {
    const s = SCHEMAS[key];
    if (!s) return { ok: false, errors: [{ field: null, error: `Unknown schema "${key}"` }] };
    const errors = [];
    s.fields.forEach(f => {
      const r = validateValue(f, record ? record[f.name] : undefined);
      if (!r.ok) errors.push({ field: f.name, error: r.error });
    });
    return { ok: errors.length === 0, errors };
  }

  /** Infer a best-guess schema from a sample of raw records (int/float/bool/date/json/string), for a first-run "propose a schema" flow — never authoritative, always editable after. */
  function inferSchema(sampleRecords) {
    const fieldTypes = {};
    (sampleRecords || []).forEach(rec => {
      if (!rec || typeof rec !== 'object') return;
      Object.keys(rec).forEach(k => {
        const v = rec[k];
        let t = 'string';
        if (typeof v === 'number') t = Number.isInteger(v) ? 'int' : 'float';
        else if (typeof v === 'boolean') t = 'bool';
        else if (v instanceof Date) t = 'datetime';
        else if (typeof v === 'object' && v !== null) t = Array.isArray(v) ? 'array' : 'json';
        else if (typeof v === 'string' && !isNaN(Date.parse(v)) && /\d{4}-\d{2}-\d{2}/.test(v)) t = 'date';
        if (!fieldTypes[k]) fieldTypes[k] = {};
        fieldTypes[k][t] = (fieldTypes[k][t] || 0) + 1;
      });
    });
    return Object.entries(fieldTypes).map(([name, counts]) => {
      const type = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      return { name, type: type === 'array' ? 'array' : type, itemType: type === 'array' ? 'json' : undefined, required: false, description: '' };
    });
  }

  return {
    BASIC_TYPES, COMPLEX_TYPES, ALL_TYPES,
    registerSchema, getSchema, listSchemas, getField,
    coerce, validateValue, validateRecord, inferSchema
  };
}));
