import express from 'express';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const protoDir = fileURLToPath(new URL('./proto/', import.meta.url));
const root = new protobuf.Root();
root.resolvePath = (_, name) => resolve(protoDir,name);
root.loadSync('opentelemetry/proto/collector/metrics/v1/metrics_service.proto');
const requestType = root.lookupType('opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest');
const responseType = root.lookupType('opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse');

const binaryType = 'application/x-protobuf';
const jsonParser = express.json({limit:'512kb'});
const binaryParser = express.raw({type:binaryType,limit:'512kb'});

export function parseOtlpHttp(req,res,next) {
  if (req.is(binaryType)) return binaryParser(req,res,error=>{
    if (error) return next(error);
    try {
      if (!Buffer.isBuffer(req.body)) return res.status(400).json({error:'Expected a protobuf metrics request.'});
      req.body = requestType.toObject(requestType.decode(req.body),{longs:String,arrays:true});
      req.otlpBinary = true;
    } catch {
      return res.status(400).json({error:'Invalid OTLP metrics protobuf.'});
    }
    next();
  });
  if (req.is('application/json')) return jsonParser(req,res,next);
  return res.status(415).json({error:'Use application/x-protobuf or application/json.'});
}

export function sendOtlpMetricsResponse(req,res,result,rejected) {
  const partialSuccess = rejected ? {
    rejectedDataPoints:String(rejected),
    errorMessage:'Unsupported metric points discarded',
  } : undefined;
  if (req.otlpBinary) {
    const bytes = responseType.encode(responseType.fromObject(partialSuccess ? {partialSuccess} : {})).finish();
    return res.type(binaryType).send(Buffer.from(bytes));
  }
  return res.json({...result,...(partialSuccess && {partialSuccess})});
}
