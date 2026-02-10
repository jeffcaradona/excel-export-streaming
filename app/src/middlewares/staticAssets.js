import path from "node:path";
import express from "express";

export function registerStatic(app, __dirname) {
  app.use(express.static(path.join(__dirname, "public")));
  app.use(
    "/css/",
    express.static(
      path.join(__dirname, "../../node_modules/bootstrap/dist/css"),
    ),
  );
  app.use(
    "/css",
    express.static(
      path.join(__dirname, "../../node_modules/bootstrap-icons/font"),
    ),
  );
  app.use(
    "/img/svg",
    express.static(
      path.join(__dirname, "../../node_modules/bootstrap-icons/icons"),
    ),
  );
  // ESM module routes
  app.use(
    "/esm/jquery",
    express.static(
      path.join(__dirname, "../../node_modules/jquery/dist-module"),
    ),
  );
  app.use(
    "/esm/datatables",
    express.static(
      path.join(__dirname, "../../node_modules/datatables.net/js"),
    ),
  );
  app.use(
    "/esm/datatables-bs5",
    express.static(
      path.join(__dirname, "../../node_modules/datatables.net-bs5/js"),
    ),
  );
  app.use(
    "/esm/bootstrap",
    express.static(
      path.join(__dirname, "../../node_modules/bootstrap/dist/js"),
    ),
  );
  app.use(
    "/css",
    express.static(
      path.join(__dirname, "../../node_modules/datatables.net-bs5/css"),
    ),
  );
}
