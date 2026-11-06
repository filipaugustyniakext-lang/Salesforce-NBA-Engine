/**
 * Marketing Cloud Engagement endpoints, authenticated by named credentials that share the
 * MarketingCloudEngagementoAuth20 external credential. The external credential must send the
 * client id and secret in the token request body, because Marketing Cloud rejects Basic auth.
 * The SOAP API does not accept the Authorization header, so SOAP envelopes carry the token
 * in a fueloauth element through the OAuthToken merge field.
 */
public with sharing class MarketingCloudApi {
    public static final String REST = 'callout:MarketingCloudEngagementAPI';
    public static final String SOAP = 'callout:MarketingCloudEngagementSOAP/Service.asmx';
    public static final String SOAP_TOKEN = '{!$Credential.OAuthToken}';
    public static final String METADATA_DATA_EXTENSION_KEY = 'CC_Message_Metadata';
    public static final String BLOCKS_DATA_EXTENSION_KEY = 'CC_Message_Blocks_All';

    private static String soapServiceUrl;

    /** SOAP WS-Addressing To value; the endpoint rejects envelopes without it. */
    public static String soapServiceUrl() {
        if (String.isNotBlank(soapServiceUrl)) {
            return soapServiceUrl;
        }
        HttpRequest req = new HttpRequest();
        req.setMethod('GET');
        req.setEndpoint(REST + '/platform/v1/endpoints/soap');
        req.setTimeout(120000);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw new CalloutException('Marketing Cloud SOAP endpoint lookup failed (' + res.getStatusCode() + ').');
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        String url = (String) body.get('url');
        if (String.isBlank(url)) {
            throw new CalloutException('Marketing Cloud did not return a SOAP endpoint.');
        }
        soapServiceUrl = url;
        return soapServiceUrl;
    }
}
