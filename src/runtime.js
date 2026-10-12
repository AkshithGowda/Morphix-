const { buildHermesJob, getJobSnapshot } = require("./hermesBridge");

async function buildVisualizationJob(job) {
  return buildHermesJob(job);
}

module.exports = {
  buildVisualizationJob,
  getJobSnapshot,
};
