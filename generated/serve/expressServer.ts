/*
* NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
* https://openapi-generator.tech
* Do not edit the class manually.
*/

import http = require("http");
import fs = require("fs");
import path = require("path");
import express = require("express");
import cors = require("cors");
import cookieParser = require("cookie-parser");
import bodyParser = require("body-parser");
// @ts-ignore
import { OpenApiValidator } from "express-openapi-validator";
import jsYaml = require("js-yaml");
import swaggerUI = require("swagger-ui-express");

import { logger } from "./logger";
import { config } from "./config";

export class ExpressServer {

  port: number;
  app: any;
  openApiPath: any;
  docPath: any;
  schema: any;
  docSchema: any;
  server: any;

  constructor(port: number, openApiYaml: any, docYaml: any) {
    this.port = port;
    this.app = express();
    this.openApiPath = openApiYaml;
    this.docPath = docYaml;
    try {
      this.schema = jsYaml.safeLoad(fs.readFileSync(openApiYaml).toString());
      this.docSchema = jsYaml.safeLoad(fs.readFileSync(docYaml).toString());
    } catch (e) {
      logger.error("failed to start Express Server", e.message);
    }
    this.setupMiddleware();
  }

  setupMiddleware() {
    // this.setupAllowedMedia();
    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: "14MB" }));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: false }));
    this.app.use(cookieParser());
    //Simple readiness indicator
    // @ts-ignore
    this.app.get("/ready", (req: any, res: any) => {
      res.status(200);
      res.json({ "status": "okay" });
    });
    //Send the openapi document *AS GENERATED BY THE GENERATOR*
    // @ts-ignore
    this.app.get("/openapi", (req: any, res: any) => res.sendFile((path.join(__dirname, "../../swagger/v1/", "api.yml"))));
    //View the openapi document in a visual interface. Should be able to test from this page
    // @ts-ignore
    this.app.get('/',(req:any, res: any)=>{
      res.redirect(301, '/api-docs');
   })
    this.app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(this.docSchema));
    this.app.get("/login-redirect", (req: any, res: any) => {
      res.status(200);
      res.json(req.query);
    });
    this.app.get("/oauth2-redirect.html", (req: any, res: any) => {
      res.status(200);
      res.json(req.query);
    });
  }

  async launch() {
    return new OpenApiValidator({
      apiSpec: this.openApiPath,
      operationHandlers: path.join(__dirname),
      fileUploader: { dest: config.FILE_UPLOAD_PATH },
    }).install(this.app)
      .catch(e => console.log(e))
      .then(async () => {
        // eslint-disable-next-line no-unused-vars
        // @ts-ignore
        this.app.use((err, req, res, nest: any) => {
          // format errors
          res.status(err.status || 500).json({
            message: err.message || err,
            errors: err.errors || "",
          });
        });
        return this.app.listen(this.port);
      });
  }


  async close() {
    if (this.server !== undefined) {
      await this.server.close();
      console.log(`Server on port ${this.port} shut down`);
    }
  }
}