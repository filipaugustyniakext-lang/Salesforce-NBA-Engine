/**
 * @description Scheduler class to execute the Data Cloud Funnel Abandonment Flow every 6 minutes.
 * Includes concurrency protection to prevent overlapping runs.
 * @author Filip Augustyniak
 */
public class FunnelAbandonmentExitFlowScheduler implements Schedulable {

    // Define the Flow API Name - UAT reference removed for PROD
    private static final String FLOW_API_NAME = 'FL_DC_DT_UC1_FunnelAbandonment_EXIT_RUNNER';

    /**
     * @description Mandatory Schedulable execute method
     * @param sc SchedulableContext
     */
    public void execute(SchedulableContext sc) {
        // 1. Check for overlapping jobs before doing anything
        if (isJobAlreadyRunning()) {
            System.debug(LoggingLevel.WARN, 'A previous instance of FunnelAbandonmentExitFlowScheduler is still running. Skipping this execution.');
            return; // Gracefully exits the transaction without throwing an error
        }

        // 2. If no overlap, proceed with flow execution
        runFlow();
    }

    /**
     * @description Checks if another instance of this scheduled job is actively executing.
     * @return Boolean True if another job is processing, False otherwise.
     */
    @TestVisible
    private static Boolean isJobAlreadyRunning() {
        // Query active AsyncApexJobs for this specific class.
        // We look for > 1 because the current executing job evaluates as 1.
        Integer activeJobsCount = [
            SELECT COUNT() 
            FROM AsyncApexJob 
            WHERE ApexClass.Name = 'FunnelAbandonmentExitFlowScheduler' 
            AND JobType = 'ScheduledApex' 
            AND Status IN ('Preparing', 'Processing')
        ];
        
        return activeJobsCount > 1;
    }

    /**
     * @description Executes the Autolaunched Flow
     */
    @TestVisible
    private static void runFlow() {
        try {
            Map<String, Object> flowParams = new Map<String, Object>();

            // Create and start the flow interview dynamically
            Flow.Interview flowInterview = Flow.Interview.createInterview(FLOW_API_NAME, flowParams);
            flowInterview.start();

            System.debug(LoggingLevel.INFO, 'Successfully executed flow: ' + FLOW_API_NAME);
            
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Error executing flow ' + FLOW_API_NAME + ': ' + e.getMessage());
        }
    }

    /**
     * @description Generates 10 Scheduled Jobs to run every 6 minutes across the hour
     */
    public static void scheduleJobs() {
        List<Integer> minuteIntervals = new List<Integer>{0, 6, 12, 18, 24, 30, 36, 42, 48, 54};

        for (Integer min : minuteIntervals) {
            String cronExp = '0 ' + min + ' * * * ?';
            String jobName = 'DC Funnel Abandonment Exit Flow - Min ' + String.valueOf(min).leftPad(2, '0');

            try {
                System.schedule(jobName, cronExp, new FunnelAbandonmentExitFlowScheduler());
                System.debug(LoggingLevel.INFO, 'Scheduled Job: ' + jobName + ' | CRON: ' + cronExp);
            } catch (Exception e) {
                System.debug(LoggingLevel.ERROR, 'Failed to schedule ' + jobName + ': ' + e.getMessage());
            }
        }
    }
}