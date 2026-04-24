import { readFileSync } from "fs";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";

/**
 * Virtual module plugin: resolves `@decky/manifest` to the contents of
 * plugin.json.  @decky/api imports this virtual module at runtime to get
 * the plugin name (used for backend callable routing).  Decky's own CLI
 * handles this automatically; we replicate it here for our custom build.
 */
const deckyManifestPlugin = {
  name: "decky-manifest",
  resolveId(source) {
    if (source === "@decky/manifest") return "\0@decky/manifest";
    return null;
  },
  load(id) {
    if (id === "\0@decky/manifest") {
      const manifest = JSON.parse(readFileSync("./plugin.json", "utf-8"));
      return `export default ${JSON.stringify(manifest)};`;
    }
    return null;
  },
};

export default {
  input: "src/index.tsx",
  plugins: [
    deckyManifestPlugin,
    commonjs(),
    nodeResolve(),
    typescript({ tsconfig: "./tsconfig.build.json" }),
    replace({
      preventAssignment: false,
      "process.env.NODE_ENV": JSON.stringify("production"),
    }),
    json(),
  ],
  external: ["react", "react-dom", "@decky/ui"],
  output: {
    file: "dist/index.js",
    globals: {
      react: "SP_REACT",
      "react-dom": "SP_REACTDOM",
      "@decky/ui": "DFL",
    },
    format: "iife",
    exports: "default",
  },
};
