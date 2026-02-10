/**
 * Error handler
 *
 * @param {Error} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} _next
 *
 */
// eslint-disable-next-line no-unused-vars
export function renderError(err, req, res, _next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
}

/**
 *
 * @param {*} err
 * @param {*} req
 * @param {*} res
 * @param {*} _next
 */
// eslint-disable-next-line no-unused-vars
export function jsonErrorHandler(err, req, res, _next) {
  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: err.message,
      status: status,
      stack: req.app.get("env") === "development" ? err.stack : {},
    },
  });
}
