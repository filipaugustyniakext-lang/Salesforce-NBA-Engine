@isTest
global class MCE_HttpMockFactory implements HttpCalloutMock {
    global HTTPResponse respond(HTTPRequest req) {
        HttpResponse res = new HttpResponse();
        res.setHeader('Content-Type', 'application/json');
        res.setBody('{"status": "OK"}');
        res.setStatusCode(201); // Udajemy sukces
        return res;
    }
}