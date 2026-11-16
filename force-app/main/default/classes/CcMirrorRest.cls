/**
 * REST ingress for SFMC CloudPages dual-write.
 *
 * POST /services/apexrest/cc/v1/mirror
 * Body:
 * {
 *   "ops": [
 *     { "operation": "upsert", "objectName": "CC_Message_Metadata", "rows": [ { ...DE fields... } ] },
 *     { "operation": "delete", "objectName": "CC_Message_Blocks_All", "keys": [ { "MessageVariantId": "...", "ContentBlockOrder": 1 } ] }
 *   ]
 * }
 */
@RestResource(urlMapping='/cc/v1/mirror')
global with sharing class CcMirrorRest {
  @HttpPost
  global static void mirror() {
    RestRequest req = RestContext.request;
    RestResponse res = RestContext.response;
    res.addHeader('Content-Type', 'application/json');

    try {
      String body = req.requestBody == null ? '' : req.requestBody.toString();
      if (String.isBlank(body)) {
        res.statusCode = 400;
        res.responseBody = Blob.valueOf('{"ok":false,"errors":["Empty body"]}');
        return;
      }

      CcMirrorService.MirrorRequest parsed = parseLoose(body);
      CcMirrorService.MirrorResponse outcome = CcMirrorService.apply(parsed);
      res.statusCode = outcome.ok ? 200 : 207;
      res.responseBody = Blob.valueOf(JSON.serialize(outcome));
    } catch (Exception ex) {
      res.statusCode = 500;
      Map<String, Object> err = new Map<String, Object>{
        'ok' => false,
        'errors' => new List<String>{ ex.getMessage() }
      };
      res.responseBody = Blob.valueOf(JSON.serialize(err));
    }
  }

  /**
   * Deserialize ops with rows/keys as List<Map<String,Object>> (typed deserialize
   * cannot populate nested untyped maps reliably).
   */
  @TestVisible
  private static CcMirrorService.MirrorRequest parseLoose(String body) {
    Map<String, Object> root = (Map<String, Object>) JSON.deserializeUntyped(body);
    CcMirrorService.MirrorRequest request = new CcMirrorService.MirrorRequest();
    request.ops = new List<CcMirrorService.MirrorOp>();

    Object opsRaw = root.get('ops');
    if (!(opsRaw instanceof List<Object>)) {
      return request;
    }

    for (Object opObj : (List<Object>) opsRaw) {
      if (!(opObj instanceof Map<String, Object>)) {
        continue;
      }
      Map<String, Object> opMap = (Map<String, Object>) opObj;
      CcMirrorService.MirrorOp op = new CcMirrorService.MirrorOp();
      op.operation = opMap.get('operation') == null ? null : String.valueOf(opMap.get('operation'));
      // accept objectName or object
      Object objectName = opMap.containsKey('objectName')
        ? opMap.get('objectName')
        : opMap.get('object');
      op.objectName = objectName == null ? null : String.valueOf(objectName);
      op.rows = toMapList(opMap.get('rows'));
      op.keys = toMapList(opMap.get('keys'));
      request.ops.add(op);
    }
    return request;
  }

  private static List<Map<String, Object>> toMapList(Object raw) {
    List<Map<String, Object>> out = new List<Map<String, Object>>();
    if (!(raw instanceof List<Object>)) {
      return out;
    }
    for (Object item : (List<Object>) raw) {
      if (item instanceof Map<String, Object>) {
        out.add((Map<String, Object>) item);
      }
    }
    return out;
  }
}