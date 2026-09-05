// Colyseus Cloud reads the named apps export through Node 22's require(ESM).
export const apps = [{
  name: 'burnhop',
  script: 'dist-server/index.mjs',
  instances: 1,
  exec_mode: 'fork',
  wait_ready: true,
  listen_timeout: 15000,
  kill_timeout: 5000,
  time: true,
  watch: false,
  env: { NODE_ENV: 'production' },
}];
