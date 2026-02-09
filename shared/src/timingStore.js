// shared/src/timingStore.js
let enabled = false;

export const timing = {
  isEnabled() {
    return enabled;
  },
  enable() {
    enabled = true;
  },
  disable() {
    enabled = false;
  },
  toggle() {
    enabled = !enabled;
    return enabled;
  },
  set(v) {
    enabled = !!v;
  },
};
