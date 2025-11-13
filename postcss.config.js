console.log("✅ Loaded postcss.config.js from:", import.meta.url);

export default {
  plugins: {
    'postcss-import': {},
    '@tailwindcss/postcss': {}, // ✅ use this instead of tailwindcss
    autoprefixer: {},
  },
};
