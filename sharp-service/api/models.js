// Share one function while preserving the existing public endpoint contracts.
const handlers = {
  nbamodel: () => import("../handlers/nbamodel.js"),
  nbaprops: () => import("../handlers/nbaprops.js"),
  providerstatus: () => import("../handlers/providerstatus.js")
};

export default async function handler(req, res) {
  const route = req.query?.route;
  if (typeof route !== "string" || !Object.hasOwn(handlers, route)) {
    return res.status(404).json({ error: "Unknown model endpoint" });
  }
  const module = await handlers[route]();
  return module.default(req, res);
}
