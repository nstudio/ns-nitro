/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{css,xml,html,vue,svelte,ts,tsx}'],
  // use the .ns-dark class to control dark mode (applied by NativeScript) - since 'media' (default) is not supported.
  darkMode: ['class', '.ns-dark'],
  theme: {
    fontSize: {
      xxs: '10',
      '2xs': '11',
      xs: '12',
      sm: '14',
      base: '16',
      lg: '18',
      xl: '20',
      '2xl': '24',
      '3xl': '30',
      '4xl': '36',
      '5xl': '48',
      '6xl': '60',
    },
    extend: {},
  },
  plugins: [],
  corePlugins: {
    preflight: false, // disables browser-specific resets
  },
}
