import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import importAssets from "rollup-plugin-import-assets";

export default {
  input: "src/index.tsx",
  plugins: [
    commonjs(),
    nodeResolve(),
    typescript({ tsconfig: "./tsconfig.build.json" }),
    replace({
      preventAssignment: false,
      "process.env.NODE_ENV": JSON.stringify("production"),
    }),
    json(),
    importAssets({
      publicPath: `http://127.0.0.1:1337/plugins/QuickLaunch/`,
    }),
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
