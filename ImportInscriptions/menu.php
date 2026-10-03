<?php
// Menu entry next to "List load" (Participants › Sync), with the same rights.
// Included from both get_which_menu() and get_which_run_menu(); in the latter $acl and $ret['PART'] may not exist.
if (!empty($on) and isset($ret['PART'], $acl) and subFeatureAcl($acl, AclParticipants, 'pAdvancedEntries') == AclReadWrite) {
	require_once(__DIR__ . '/lib.php');
	$ret['PART']['SYNC'][] = ii_t('menu') . '|' . $CFG->ROOT_DIR . 'Modules/Custom/ImportInscriptions/index.php';
}
