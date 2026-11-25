const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createOriginGuard(allowedOrigin) {
  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) return next();

    const requestOrigin = req.get("Origin");
    if (requestOrigin && requestOrigin !== allowedOrigin) {
      return res.status(403).json({ error: "Untrusted origin" });
    }

    return next();
  };
}
