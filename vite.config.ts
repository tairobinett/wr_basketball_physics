import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    // Deliberately not auto-opening a browser: this repo lives on the WSL filesystem and may be
    // served from either side, so hijacking a browser on `npm run dev` is more surprising than
    // helpful.
    //
    // Polling is not an optimisation, it is a requirement here. Running Windows Vite against the
    // repo over \\wsl.localhost means native fs.watch fails outright ("EISDIR: illegal operation on
    // a directory, watch ...") because file watching does not work over an SMB/UNC share. Polling
    // sidesteps it. Running from inside WSL instead, polling is merely unnecessary — a little CPU
    // for a background timer — so it is left on so that both ways of working just work.
    watch: { usePolling: true, interval: 300 },
  },
  build: { target: 'es2022', sourcemap: true },
});
