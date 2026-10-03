<?php
/*
 * Entry import — JSON API used by the page.
 * Same rights as Partecipants/ListLoad.php; updating the module requires administrator rights.
 */
require_once(dirname(__FILE__, 4) . '/config.php');
require_once(__DIR__ . '/lib.php');

if (!CheckTourSession()) JsonOut(array('error' => ii_t('noTournament')));
if (!hasFullACL(AclParticipants, 'pAdvancedEntries', AclReadWrite)) JsonOut(array('error' => ii_t('forbidden')));

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) $in = $_POST;
$action = $_GET['action'] ?? ($in['action'] ?? '');

function ii_require_admin() {
	if (!hasFullACL(AclRoot, '', AclReadWrite)) JsonOut(array('error' => ii_t('adminOnly')));
}

try {
	switch ($action) {
		case 'licenses':
			JsonOut(array('licenses' => ii_lookup_licenses($in['codes'] ?? array())));

		case 'search':
			JsonOut(array('results' => ii_search_archers((string)($in['lastName'] ?? ''), (string)($in['firstName'] ?? ''))));

		case 'clubs':
			JsonOut(array('clubs' => ii_clubs()));

		case 'parse':
			if (empty($_FILES['file']) or $_FILES['file']['error'] != UPLOAD_ERR_OK) JsonOut(array('error' => ii_t('fileMissing')));
			$ext = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
			if (!in_array($ext, array('xlsx', 'xls', 'ods'))) JsonOut(array('error' => ii_t('fileFormat')));
			$tmp = $_FILES['file']['tmp_name'] . '.' . $ext;
			move_uploaded_file($_FILES['file']['tmp_name'], $tmp);
			try {
				$rows = ii_read_spreadsheet($tmp);
			} finally {
				@unlink($tmp);
			}
			JsonOut(array('rows' => $rows));

		case 'settings':
			// competition mapping: profile, columns, values, options
			ii_set('settings', $in['settings'] ?? new stdClass());
			JsonOut(array('ok' => true));

		case 'correction':
			$key = (string)($in['key'] ?? '');
			if ($key === '') JsonOut(array('error' => ii_t('keyMissing')));
			$all = ii_get('corrections', array());
			if (empty($in['correction'])) unset($all[$key]);
			else $all[$key] = $in['correction'];
			ii_set('corrections', $all ?: new stdClass());
			JsonOut(array('ok' => true, 'corrections' => $all ?: new stdClass()));

		case 'profile':
			$profiles = ii_get_global('profiles', array());
			$p = $in['profile'] ?? null;
			if (!empty($in['delete'])) {
				$profiles = array_values(array_filter($profiles, function ($x) use ($in) { return $x['id'] !== $in['delete']; }));
			} elseif (is_array($p) and !empty($p['id']) and !empty($p['name'])) {
				$p['builtin'] = false;
				$profiles = array_values(array_filter($profiles, function ($x) use ($p) { return $x['id'] !== $p['id']; }));
				$profiles[] = $p;
			} else {
				JsonOut(array('error' => ii_t('profileInvalid')));
			}
			ii_set_global('profiles', $profiles);
			JsonOut(array('ok' => true, 'profiles' => $profiles));

		case 'update-check':
			ii_require_admin();
			JsonOut(ii_update_check(!empty($in['force'])));

		case 'update-channel':
			ii_require_admin();
			if (!in_array($in['channel'] ?? '', array('stable', 'nightly'))) JsonOut(array('error' => ii_t('channelInvalid')));
			ii_set_global('channel', $in['channel']);
			JsonOut(array('ok' => true, 'channel' => $in['channel']));

		case 'update-install':
			ii_require_admin();
			JsonOut(ii_update_install());
	}
	JsonOut(array('error' => ii_t('unknownAction')));
} catch (Throwable $e) {
	JsonOut(array('error' => $e->getMessage()));
}
