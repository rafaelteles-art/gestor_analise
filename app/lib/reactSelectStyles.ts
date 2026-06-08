import type { StylesConfig, GroupBase } from 'react-select';

/**
 * Shared react-select styles driven by CSS variables (see globals.css --rs-*).
 * Because the values are CSS vars, the menu portal also tracks the .dark class.
 * Spread per-instance overrides after this if needed.
 */
export const darkAwareSelectStyles: StylesConfig<any, boolean, GroupBase<any>> = {
  control: (base) => ({
    ...base,
    minHeight: '38px',
    borderRadius: '0.5rem',
    backgroundColor: 'var(--rs-bg)',
    borderColor: 'var(--rs-border)',
    color: 'var(--rs-text)',
  }),
  singleValue: (base) => ({ ...base, color: 'var(--rs-text)' }),
  input: (base) => ({ ...base, color: 'var(--rs-text)' }),
  placeholder: (base) => ({ ...base, color: 'var(--rs-placeholder)' }),
  menu: (base) => ({ ...base, backgroundColor: 'var(--rs-menu-bg)', zIndex: 50 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? 'var(--rs-option-hover)' : 'transparent',
    color: 'var(--rs-text)',
    ':active': { backgroundColor: 'var(--rs-option-hover)' },
  }),
  multiValue: (base) => ({ ...base, backgroundColor: 'var(--rs-multi-bg)' }),
  multiValueLabel: (base) => ({ ...base, color: 'var(--rs-text)' }),
};
