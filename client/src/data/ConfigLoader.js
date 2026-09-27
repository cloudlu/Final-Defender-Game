/**
 * ConfigLoader: loads and validates game config data at startup.
 * Errors at startup = config issues (fail fast).
 * 校验"消费端真实读取的字段"，而非名义字段——防止数据/引擎脱节。
 */

const REQUIRED_FIELDS = {
  towers: ['id', 'name', 'behaviors', 'stats', 'price'],
  enemies: ['id', 'name', 'hp', 'speed', 'bounty'],
  skills: ['id', 'name', 'rarity', 'effects'],
};

const NUMERIC_STATS = ['damage', 'attackSpeed', 'range', 'critRate', 'critDamage', 'slowPct', 'goldBonus'];

export class ConfigLoader {
  constructor() {
    this.configs = {};
    this.errors = [];
    this.knownBehaviors = null;
  }

  /**
   * Register the set of behavior names the engine can actually dispatch.
   * @param {string[]} names
   */
  registerBehaviors(names) {
    this.knownBehaviors = new Set(names);
  }

  /**
   * Load a config from a plain object (already parsed JSON).
   * @param {string} name - config name (e.g., 'enemies')
   * @param {object|Array} data
   */
  load(name, data) {
    this.configs[name] = data;
    const required = REQUIRED_FIELDS[name];
    if (!required) return;

    const items = Array.isArray(data) ? data : Object.values(data);
    for (const item of items) {
      for (const field of required) {
        if (item[field] === undefined || item[field] === null) {
          this.errors.push(`[${name}] Missing required field "${field}" in item "${item.id || JSON.stringify(item)}"`);
        }
      }
      if (item.id && !/^[a-zA-Z0-9_]+$/.test(item.id)) {
        this.errors.push(`[${name}] Invalid id "${item.id}" - ids must be alphanumeric with underscores only`);
      }
      if (item.stats) {
        for (const [key, val] of Object.entries(item.stats)) {
          if (typeof val !== 'number') {
            this.errors.push(`[${name}] stats.${key} in "${item.id}" must be a number, got ${typeof val}`);
          }
        }
      }
      if (item.effects) {
        for (const eff of item.effects) {
          if (eff.value !== undefined && typeof eff.value !== 'number') {
            this.errors.push(`[${name}] effects.value in "${item.id}" must be a number`);
          }
          if (eff.stat !== undefined && !NUMERIC_STATS.includes(eff.stat)) {
            this.errors.push(`[${name}] Unknown effect stat "${eff.stat}" in "${item.id}"`);
          }
        }
      }
      if (name === 'enemies') this._validateEnemy(item);
    }
  }

  _validateEnemy(item) {
    for (const key of ['hp', 'speed', 'bounty']) {
      if (item[key] !== undefined && typeof item[key] !== 'number') {
        this.errors.push(`[enemies] ${key} in "${item.id}" must be a number`);
      }
    }
    for (const key of ['hp', 'speed']) {
      if (typeof item[key] === 'number' && item[key] <= 0) {
        this.errors.push(`[enemies] ${key} in "${item.id}" must be > 0`);
      }
    }
    if (item.armor !== undefined && typeof item.armor !== 'number') {
      this.errors.push(`[enemies] armor in "${item.id}" must be a number`);
    }
    if (item.behavior) {
      if (typeof item.behavior.type !== 'string') {
        this.errors.push(`[enemies] behavior.type in "${item.id}" must be a string`);
      } else if (this.knownBehaviors && !this.knownBehaviors.has(item.behavior.type)) {
        this.errors.push(`[enemies] Unknown behavior "${item.behavior.type}" in "${item.id}" - register it with registerBehaviors()`);
      }
      if (item.behavior.type === 'split') {
        if (typeof item.behavior.count !== 'number' || item.behavior.count < 1) {
          this.errors.push(`[enemies] split.count in "${item.id}" must be a number >= 1`);
        }
        if (typeof item.behavior.enemyId !== 'string') {
          this.errors.push(`[enemies] split.enemyId in "${item.id}" must be a string`);
        }
      }
    }
  }

  /**
   * Get a config by name.
   * @returns {object|Array}
   */
  get(name) {
    return this.configs[name];
  }

  /**
   * Get a specific item by id from a named config.
   */
  getById(configName, id) {
    const data = this.configs[configName];
    if (Array.isArray(data)) return data.find(item => item.id === id);
    return data?.[id];
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  getErrors() {
    return [...this.errors];
  }
}
