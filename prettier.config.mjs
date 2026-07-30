/** @type {import('prettier').Config} */
const config = {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 90,
  plugins: ['prettier-plugin-tailwindcss'],
  // Tailwind v4 has no JS config file for the plugin to discover, so the
  // stylesheet carrying the @theme block has to be named explicitly. Without
  // this the class sorter falls back to Tailwind's default scale and cannot
  // see our tokens.
  tailwindStylesheet: './src/app/globals.css',
}

export default config
