<?php
// Entrée de menu, à côté de « Import liste » (Participants › Synchronisation), avec les mêmes droits.
if (!empty($on) and isset($ret['PART'], $acl) and subFeatureAcl($acl, AclParticipants, 'pAdvancedEntries') == AclReadWrite) {
	$ret['PART']['SYNC'][] = 'Import inscriptions (CSV/Excel)|' . $CFG->ROOT_DIR . 'Modules/Custom/ImportInscriptions/index.php';
}
