function buildBoaStatusPayload() {
  return {
    status: 'ok',
    module: 'boa',
    mounted: true,
    routes: {
      status: '/api/boa/status',
      eligibility: '/api/boa/eligibility',
    },
    timestamp: new Date().toISOString(),
  };
}

function registerBoaStatusRoutes(app) {
  app.get('/api/boa/status', (req, res) => {
    res.json(buildBoaStatusPayload());
  });
}

module.exports = {
  buildBoaStatusPayload,
  registerBoaStatusRoutes,
};
