import { defineConfig } from 'vite';

// Relative paths, so the build works at GitHub Pages' /padel/ as well as at a root.
export default defineConfig({ base: './' });
