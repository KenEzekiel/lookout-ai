UPDATE monitoring_rule SET definition=json_remove(json_set(definition,'$.escalationLevels',json_array(
 json_object('recipientIds',json_extract(definition,'$.recipientIds'),'acknowledgmentTimeoutSeconds',json_extract(definition,'$.escalationDelaySeconds')),
 json_object('recipientIds',json_extract(definition,'$.recipientIds'),'acknowledgmentTimeoutSeconds',NULL)
)), '$.recipientIds','$.escalationDelaySeconds');
UPDATE incident SET context=json_remove(json_set(context,'$.rule.definition.escalationLevels',json_array(
 json_object('recipientIds',json_extract(context,'$.rule.definition.recipientIds'),'acknowledgmentTimeoutSeconds',json_extract(context,'$.rule.definition.escalationDelaySeconds')),
 json_object('recipientIds',json_extract(context,'$.rule.definition.recipientIds'),'acknowledgmentTimeoutSeconds',NULL)
)), '$.rule.definition.recipientIds','$.rule.definition.escalationDelaySeconds');
ALTER TABLE incident ADD COLUMN escalation_activations TEXT NOT NULL DEFAULT '[]';
UPDATE incident SET escalation_activations=CASE WHEN follow_up_attempted_at IS NULL THEN json_array(received_at) ELSE json_array(received_at,follow_up_attempted_at) END;
UPDATE incident SET follow_up_due_at=NULL WHERE follow_up_attempted_at IS NOT NULL;
