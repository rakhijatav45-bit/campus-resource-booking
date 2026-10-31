import { HttpError } from './errors.js';

const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function isRealDate(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

// Collects every problem in one pass so the client can show them all at once.
export class Fields {
  constructor(source) {
    this.source = source && typeof source === 'object' ? source : {};
    this.errors = {};
  }

  fail(name, message) {
    this.errors[name] ??= message;
    return undefined;
  }

  raw(name, required) {
    const value = this.source[name];
    if (value === undefined || value === null || value === '') {
      if (required) this.fail(name, `${name} is required`);
      return undefined;
    }
    return value;
  }

  string(name, { min = 1, max = 255, required = true, trim = true, allowEmpty = false } = {}) {
    let value = this.source[name];
    if (allowEmpty && value === '') return '';
    value = this.raw(name, required);
    if (value === undefined) return undefined;
    if (typeof value !== 'string') return this.fail(name, `${name} must be text`);
    if (trim) value = value.trim();
    if (value.length < min) return this.fail(name, `${name} must be at least ${min} characters`);
    if (value.length > max) return this.fail(name, `${name} must be at most ${max} characters`);
    return value;
  }

  integer(name, { min = -Infinity, max = Infinity, required = true, coerce = false } = {}) {
    let value = this.raw(name, required);
    if (value === undefined) return undefined;
    if (coerce && typeof value === 'string' && /^-?\d+$/.test(value)) value = Number(value);
    if (!Number.isInteger(value)) return this.fail(name, `${name} must be a whole number`);
    if (value < min || value > max) {
      return this.fail(name, `${name} must be between ${min} and ${max}`);
    }
    return value;
  }

  boolean(name, { required = true, coerce = false } = {}) {
    let value = this.raw(name, required);
    if (value === undefined) return undefined;
    if (coerce && value === 'true') value = true;
    if (coerce && value === 'false') value = false;
    if (typeof value !== 'boolean') return this.fail(name, `${name} must be true or false`);
    return value;
  }

  oneOf(name, allowed, { required = true } = {}) {
    const value = this.raw(name, required);
    if (value === undefined) return undefined;
    if (!allowed.includes(value)) return this.fail(name, `${name} must be one of: ${allowed.join(', ')}`);
    return value;
  }

  instant(name, { required = true } = {}) {
    const value = this.raw(name, required);
    if (value === undefined) return undefined;
    const message = `${name} must be an ISO 8601 date-time with a timezone, e.g. 2026-11-02T10:00:00+05:30`;
    const match = typeof value === 'string' ? ISO_WITH_ZONE.exec(value) : null;
    if (!match) return this.fail(name, message);
    const [year, month, day, hour, minute, second = 0] = match.slice(1, 7).map(Number);
    const date = new Date(value);
    if (!isRealDate(year, month, day, hour, minute, second) || Number.isNaN(date.getTime())) {
      return this.fail(name, message);
    }
    return date;
  }

  done() {
    if (Object.keys(this.errors).length > 0) {
      throw new HttpError(400, 'validation_error', 'Some fields are invalid', this.errors);
    }
  }
}
