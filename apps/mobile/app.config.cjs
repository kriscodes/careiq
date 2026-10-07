const { createMobileBuildConfig } = require("./release-config.cjs");
module.exports = ({ config }) => createMobileBuildConfig(config, process.env);
