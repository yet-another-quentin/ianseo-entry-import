<?php
/*
 * Entry import — PHP helpers shared by the page and the API.
 * The module never writes to IANSEO's archer tables (Entries, Qualifications…):
 * the import itself is delegated to Partecipants/ListLoad.php.
 */

require_once('Common/Lib/Fun_Modules.php');

const II_MODULE = 'EntryImport';

function ii_version_info() {
	$v = @json_decode(@file_get_contents(__DIR__ . '/version.json'), true);
	return is_array($v) ? $v : array('version' => '0.0.0', 'repo' => '', 'asset' => II_MODULE . '.zip');
}

// ---------- language ----------

// French if IANSEO runs in French, English otherwise.
function ii_lang() {
	return preg_match('/^fr/i', (string)SelectLanguage()) ? 'fr' : 'en';
}

// Server-side messages (API errors). The page has its own dictionaries (i18n.js).
function ii_t($key, $params = array()) {
	static $dict = array(
		'en' => array(
			'menu' => 'Entry import (CSV/Excel)',
			'noTournament' => 'No competition open',
			'forbidden' => 'Insufficient rights',
			'adminOnly' => 'Administrator only',
			'unknownAction' => 'Unknown action',
			'fileMissing' => 'File not received',
			'fileFormat' => 'Unsupported format',
			'keyMissing' => 'Missing key',
			'profileInvalid' => 'Invalid profile',
			'channelInvalid' => 'Invalid channel',
			'repoMissing' => 'Repository not configured',
			'connection' => 'connection failed',
			'connectionFopen' => 'connection failed (curl missing, allow_url_fopen or SSL?)',
			'githubUnexpected' => 'unexpected GitHub answer',
			'noRelease' => 'no release published yet',
			'noUpdate' => 'No new version',
			'manual' => ' — Manual update: download {asset} and unzip it into Modules/Custom/.',
			'zipMissing' => 'PHP "zip" extension missing',
			'notWritable' => 'Module folder not writable by the web server',
			'downloadFailed' => 'Download failed: {error}',
			'zipUnreadable' => 'Unreadable archive',
			'zipRefused' => 'Archive refused: unexpected path "{name}"',
			'zipIncomplete' => 'Incomplete archive',
			'versionInvalid' => 'Invalid version.json in the archive',
			'backupFailed' => 'Backup failed',
			'copyFailed' => 'Cannot copy the new files: previous version restored',
			'status' => 'Status {n}',
		),
		'fr' => array(
			'menu' => 'Import inscriptions (CSV/Excel)',
			'noTournament' => 'Aucune compétition ouverte',
			'forbidden' => 'Droits insuffisants',
			'adminOnly' => 'Réservé à l\'administrateur',
			'unknownAction' => 'Action inconnue',
			'fileMissing' => 'Fichier non reçu',
			'fileFormat' => 'Format non pris en charge',
			'keyMissing' => 'Clé manquante',
			'profileInvalid' => 'Profil invalide',
			'channelInvalid' => 'Canal invalide',
			'repoMissing' => 'Dépôt non configuré',
			'connection' => 'connexion impossible',
			'connectionFopen' => 'connexion impossible (curl absent, allow_url_fopen ou SSL ?)',
			'githubUnexpected' => 'réponse GitHub inattendue',
			'noRelease' => 'aucune version publiée pour le moment',
			'noUpdate' => 'Aucune nouvelle version',
			'manual' => ' — Mise à jour manuelle : télécharger {asset} et décompresser son contenu dans Modules/Custom/.',
			'zipMissing' => 'Extension PHP « zip » absente',
			'notWritable' => 'Dossier du module non modifiable par le serveur web',
			'downloadFailed' => 'Téléchargement impossible : {error}',
			'zipUnreadable' => 'Archive illisible',
			'zipRefused' => 'Archive refusée : chemin inattendu « {name} »',
			'zipIncomplete' => 'Archive incomplète',
			'versionInvalid' => 'version.json invalide dans l\'archive',
			'backupFailed' => 'Sauvegarde impossible',
			'copyFailed' => 'Copie des nouveaux fichiers impossible : ancienne version restaurée',
			'status' => 'Statut {n}',
		),
	);
	$s = $dict[ii_lang()][$key] ?? $dict['en'][$key] ?? $key;
	foreach ($params as $k => $v) $s = str_replace('{' . $k . '}', (string)$v, $s);
	return $s;
}

// ---------- parameters ----------
// Values are stored as JSON strings so that no PHP object is ever unserialized.

// Per competition (open competition).
function ii_get($param, $default = null) {
	$v = getModuleParameter(II_MODULE, $param, '');
	if ($v === '' or $v === null) return $default;
	$d = json_decode($v, true);
	return $d === null ? $default : $d;
}

function ii_set($param, $value) {
	setModuleParameter(II_MODULE, $param, json_encode($value, JSON_UNESCAPED_UNICODE));
}

// Installation-wide (profiles, update channel and cache): MpTournament = 0. setModuleParameter() cannot be used:
// it replaces an empty TourId with the open competition.
function ii_get_global($param, $default = null) {
	$q = safe_r_sql("select MpValue from ModulesParameters where MpModule=" . StrSafe_DB(II_MODULE)
		. " and MpParameter=" . StrSafe_DB($param) . " and MpTournament=0");
	if ($r = safe_fetch($q)) {
		$v = @unserialize($r->MpValue);
		$d = json_decode($v === false ? $r->MpValue : $v, true);
		return $d === null ? $default : $d;
	}
	return $default;
}

function ii_set_global($param, $value) {
	$v = StrSafe_DB(serialize(json_encode($value, JSON_UNESCAPED_UNICODE)));
	safe_w_sql("insert into ModulesParameters set MpModule=" . StrSafe_DB(II_MODULE)
		. ", MpParameter=" . StrSafe_DB($param) . ", MpTournament=0, MpValue=$v"
		. " on duplicate key update MpValue=$v");
}

// ---------- open competition context ----------

function ii_tournament() {
	$q = safe_r_sql("select ToIocCode, ToWhenFrom, ToWhenTo from Tournament where ToId=" . intval($_SESSION['TourId']));
	return safe_fetch($q);
}

function ii_channel() {
	return ii_get_global('channel', 'stable') === 'nightly' ? 'nightly' : 'stable';
}

function ii_context() {
	global $CFG;
	$TourId = intval($_SESSION['TourId']);
	$tour = ii_tournament();

	$sessions = array();
	$q = safe_r_sql("select SesOrder, SesName, SesTar4Session, SesAth4Target from Session
		where SesTournament=$TourId and SesType='Q' order by SesOrder");
	while ($r = safe_fetch($q)) {
		$sessions[] = array(
			'order' => intval($r->SesOrder),
			'name' => $r->SesName,
			'capacity' => intval($r->SesTar4Session) * intval($r->SesAth4Target),
		);
	}

	$divisions = array();
	$q = safe_r_sql("select DivId, DivDescription, DivIsPara from Divisions
		where DivTournament=$TourId and DivAthlete='1' order by DivViewOrder");
	while ($r = safe_fetch($q)) {
		$divisions[] = array('id' => $r->DivId, 'name' => $r->DivDescription, 'para' => intval($r->DivIsPara) == 1);
	}

	$classes = array();
	$q = safe_r_sql("select ClId, ClDescription, ClDivisionsAllowed from Classes
		where ClTournament=$TourId and ClAthlete='1' order by ClViewOrder");
	while ($r = safe_fetch($q)) {
		$allowed = trim($r->ClDivisionsAllowed);
		$classes[] = array(
			'id' => $r->ClId,
			'name' => $r->ClDescription,
			'divisions' => $allowed === '' ? array() : array_map('trim', explode(',', $allowed)),
		);
	}

	$q = safe_r_sql("select count(*) as n from LookUpEntries where LueIocCode=" . StrSafe_DB($tour->ToIocCode));
	$lookupCount = intval(safe_fetch($q)->n);

	$version = ii_version_info();

	return array(
		'lang' => ii_lang(),
		'tour' => array('name' => $_SESSION['TourName'], 'ioc' => $tour->ToIocCode, 'from' => $tour->ToWhenFrom, 'to' => $tour->ToWhenTo),
		'sessions' => $sessions,
		'divisions' => $divisions,
		'classes' => $classes,
		'lookupCount' => $lookupCount,
		'settings' => ii_get('settings', new stdClass()),
		'corrections' => ii_get('corrections', new stdClass()),
		'profiles' => ii_get_global('profiles', array()),
		'isAdmin' => hasFullACL(AclRoot, '', AclReadWrite),
		'channel' => ii_channel(),
		'version' => $version['version'],
		'listLoadUrl' => $CFG->ROOT_DIR . 'Partecipants/ListLoad.php',
		'syncUrl' => $CFG->ROOT_DIR . 'Partecipants/LookupTableLoad.php',
	);
}

// ---------- license database ----------

function ii_status_label($status) {
	$t = get_text('Status_' . intval($status));
	return $t ? strip_tags($t) : ii_t('status', array('n' => intval($status)));
}

function ii_birth_date($d) {
	return ($d and $d != '0000-00-00') ? $d : '';
}

/**
 * License lookup with the same query as Partecipants/ListLoad.php
 * (exact LueCode + competition IOC code, ORDER BY LueDefault DESC): what the module sees is what the import will find.
 * Validity computed like Partecipants/SearchArcher.php (status 5 when the license expires before the competition).
 */
function ii_lookup_licenses($codes) {
	$tour = ii_tournament();
	$TourId = intval($_SESSION['TourId']);
	$out = array();
	$codes = array_values(array_unique(array_filter(array_map(function ($c) {
		return strtoupper(preg_replace('/[\s.\-]/', '', (string)$c));
	}, (array)$codes))));
	foreach ($codes as $c) $out[$c] = array('found' => false, 'entries' => array());

	foreach (array_chunk($codes, 200) as $chunk) {
		$in = implode(',', array_map('StrSafe_DB', $chunk));
		$q = safe_r_sql("select * from LookUpEntries where LueCode in ($in) and LueIocCode=" . StrSafe_DB($tour->ToIocCode)
			. " order by LueDefault desc");
		while ($r = safe_fetch($q)) {
			$code = strtoupper($r->LueCode);
			if (!isset($out[$code]) or $out[$code]['found']) continue;
			$status = intval($r->LueStatus);
			if ($r->LueStatusValidUntil and $r->LueStatusValidUntil != '0000-00-00' and $tour->ToWhenFrom > $r->LueStatusValidUntil) $status = 5;
			$out[$code] = array(
				'found' => true,
				'lastName' => $r->LueFamilyName,
				'firstName' => $r->LueName,
				'sex' => intval($r->LueSex) ? 'F' : 'H',
				'club' => $r->LueCoShort ?: $r->LueCoDescr,
				'clubCode' => $r->LueCountry,
				'division' => $r->LueDivision,
				'class' => $r->LueClass,
				'birthDate' => ii_birth_date($r->LueCtrlCode),
				'status' => $status,
				'statusLabel' => ii_status_label($status),
				'valid' => in_array($status, array(0, 1)),
				'entries' => array(),
			);
		}

		// archers already in the competition (information only)
		$q = safe_r_sql("select EnCode, EnDivision, QuSession from Entries inner join Qualifications on QuId=EnId
			where EnTournament=$TourId and EnCode in ($in) order by QuSession");
		while ($r = safe_fetch($q)) {
			$code = strtoupper($r->EnCode);
			if (isset($out[$code])) $out[$code]['entries'][] = array('session' => intval($r->QuSession), 'division' => $r->EnDivision);
		}
	}
	return $out;
}

// Name search, to find an archer's right license.
function ii_search_archers($lastName, $firstName) {
	$tour = ii_tournament();
	$res = array();
	foreach (array(array($lastName, $firstName), array($lastName, '')) as $try) {
		if (trim($try[0]) === '') continue;
		$sql = "select LueCode, LueFamilyName, LueName, LueSex, LueCoShort, LueCoDescr, LueCtrlCode, LueDivision, LueClass from LookUpEntries
			where LueIocCode=" . StrSafe_DB($tour->ToIocCode) . " and LueFamilyName like " . StrSafe_DB(trim($try[0]) . '%');
		if (trim($try[1]) !== '') $sql .= " and LueName like " . StrSafe_DB(trim($try[1]) . '%');
		$q = safe_r_sql($sql . " order by LueFamilyName, LueName limit 20");
		while ($r = safe_fetch($q)) {
			$res[$r->LueCode] = array(
				'license' => $r->LueCode, 'lastName' => $r->LueFamilyName, 'firstName' => $r->LueName,
				'sex' => intval($r->LueSex) ? 'F' : 'H', 'club' => $r->LueCoShort ?: $r->LueCoDescr,
				'birthDate' => ii_birth_date($r->LueCtrlCode), 'division' => $r->LueDivision, 'class' => $r->LueClass,
			);
		}
		if ($res) break;
	}
	return array_values($res);
}

// Known clubs (license database + clubs already in the competition), for "import without database".
function ii_clubs() {
	$tour = ii_tournament();
	$TourId = intval($_SESSION['TourId']);
	$clubs = array();
	$q = safe_r_sql("select distinct LueCountry as code, if(LueCoShort!='', LueCoShort, LueCoDescr) as name from LookUpEntries
		where LueIocCode=" . StrSafe_DB($tour->ToIocCode) . " and LueCountry!=''");
	while ($r = safe_fetch($q)) $clubs[$r->code] = $r->name;
	$q = safe_r_sql("select CoCode as code, CoName as name from Countries where CoTournament=$TourId");
	while ($r = safe_fetch($q)) if (!isset($clubs[$r->code])) $clubs[$r->code] = $r->name;
	asort($clubs);
	$out = array();
	foreach ($clubs as $code => $name) $out[] = array('code' => (string)$code, 'name' => $name);
	return $out;
}

// ---------- Excel / ODS files (PhpSpreadsheet, shipped with IANSEO) ----------

/**
 * Formatted cell values, except dates: Excel's default date format comes out month-first (mm-dd-yy),
 * so date cells are returned as yyyy-mm-dd.
 */
function ii_read_spreadsheet($path) {
	global $CFG;
	require_once($CFG->DOCUMENT_PATH . 'Common/vendor/autoload.php');
	$sheet = \PhpOffice\PhpSpreadsheet\IOFactory::load($path)->getActiveSheet();
	$rows = array();
	foreach ($sheet->getRowIterator() as $row) {
		$cells = $row->getCellIterator();
		$cells->setIterateOnlyExistingCells(false);
		$values = array();
		foreach ($cells as $cell) {
			$raw = $cell->getValue();
			if (is_numeric($raw) and \PhpOffice\PhpSpreadsheet\Shared\Date::isDateTime($cell)) {
				$values[] = \PhpOffice\PhpSpreadsheet\Shared\Date::excelToDateTimeObject($raw)->format('Y-m-d');
			} else {
				$values[] = (string)$cell->getFormattedValue();
			}
		}
		foreach ($values as $v) {
			if (trim($v) !== '') { $rows[] = $values; break; }
		}
	}
	return $rows;
}

// ---------- updates from GitHub releases ----------

function ii_http_get($url, $accept = '*/*') {
	$ua = 'IANSEO-EntryImport';
	if (function_exists('curl_init')) {
		$ch = curl_init($url);
		curl_setopt_array($ch, array(
			CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5,
			CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 60,
			CURLOPT_HTTPHEADER => array('User-Agent: ' . $ua, 'Accept: ' . $accept),
		));
		$body = curl_exec($ch);
		$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		$err = curl_error($ch);
		curl_close($ch);
		if ($body === false) return array(0, '', $err ?: ii_t('connection'));
		return array($code, $body, $code >= 400 ? "HTTP $code" : '');
	}
	$context = stream_context_create(array('http' => array(
		'header' => "User-Agent: $ua\r\nAccept: $accept\r\n", 'timeout' => 60, 'ignore_errors' => true, 'follow_location' => 1,
	)));
	$body = @file_get_contents($url, false, $context);
	if ($body === false) return array(0, '', ii_t('connectionFopen'));
	$code = 0;
	if (!empty($http_response_header)) {
		foreach ($http_response_header as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = intval($m[1]);
	}
	return array($code, $body, $code >= 400 ? "HTTP $code" : '');
}

/**
 * Is $latest an update for $current on this channel?
 * Stable: strictly newer version. Nightly: any different build, unless the installed version is a newer stable
 * (nightly versions are "X.Y.(Z+1)-nightly.DATE.SHA", which version_compare() puts before "X.Y.(Z+1)").
 */
function ii_is_update($channel, $latest, $current) {
	if ($latest === '' or $latest === $current) return false;
	if ($channel === 'nightly') return strpos($current, '-nightly') !== false or version_compare($latest, $current, '>');
	return version_compare($latest, $current, '>');
}

function ii_update_check($force = false) {
	$info = ii_version_info();
	$channel = ii_channel();
	$cache = ii_get_global('updateCheck', array());
	if (!$force and !empty($cache['at']) and time() - $cache['at'] < 86400
		and ($cache['current'] ?? '') === $info['version'] and ($cache['channel'] ?? '') === $channel) {
		return $cache;
	}
	$res = array('at' => time(), 'channel' => $channel, 'current' => $info['version'], 'latest' => '', 'notes' => '', 'asset' => '', 'url' => '', 'error' => '');
	if (empty($info['repo'])) {
		$res['error'] = ii_t('repoMissing');
	} else {
		// `api` (optional in version.json) allows testing against a fake release server
		$api = rtrim($info['api'] ?? 'https://api.github.com', '/');
		$path = $channel === 'nightly' ? '/releases/tags/nightly' : '/releases/latest';
		list($code, $body, $err) = ii_http_get($api . '/repos/' . $info['repo'] . $path, 'application/vnd.github+json');
		$j = $err ? null : json_decode($body, true);
		if ($code == 404) {
			$res['error'] = ii_t('noRelease');
		} elseif (!$j or empty($j['tag_name'])) {
			$res['error'] = $err ?: ii_t('githubUnexpected');
		} else {
			$res['notes'] = (string)($j['body'] ?? '');
			$res['url'] = (string)($j['html_url'] ?? '');
			foreach ((array)($j['assets'] ?? array()) as $a) {
				if (($a['name'] ?? '') === $info['asset']) $res['asset'] = $a['browser_download_url'];
			}
			// the nightly tag is fixed ("nightly"): its version is in the release name
			$res['latest'] = $channel === 'nightly' ? trim((string)($j['name'] ?? '')) : ltrim($j['tag_name'], 'vV');
		}
	}
	$res['available'] = ($res['asset'] !== '' and ii_is_update($channel, $res['latest'], $info['version']));
	ii_set_global('updateCheck', $res);
	return $res;
}

function ii_rrmdir($dir) {
	if (!is_dir($dir)) return;
	foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
		$f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
	}
	@rmdir($dir);
}

function ii_rcopy($src, $dst) {
	if (!is_dir($dst) and !@mkdir($dst, 0775, true)) return false;
	$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
	foreach ($it as $f) {
		$target = $dst . DIRECTORY_SEPARATOR . $it->getSubPathName();
		if ($f->isDir()) {
			if (!is_dir($target) and !@mkdir($target, 0775, true)) return false;
		} elseif (!@copy($f->getPathname(), $target)) {
			return false;
		}
	}
	return true;
}

/**
 * Installs the release found by ii_update_check(). The current version is backed up in the server's temporary
 * folder — not in Modules/Custom/, where IANSEO would load its menu.php — and restored if any step fails.
 * Files are copied rather than renamed (Windows/XAMPP may lock them).
 */
function ii_update_install() {
	$check = ii_update_check(true);
	if (!$check['available']) return array('error' => $check['error'] ?: ii_t('noUpdate'));
	$manual = ii_t('manual', array('asset' => $check['asset']));
	if (!class_exists('ZipArchive')) return array('error' => ii_t('zipMissing') . $manual);

	$dir = __DIR__;
	if (!is_writable($dir)) return array('error' => ii_t('notWritable') . $manual);

	list($code, $body, $err) = ii_http_get($check['asset'], 'application/octet-stream');
	if ($err or !$body) return array('error' => ii_t('downloadFailed', array('error' => $err)) . $manual);

	$tmp = tempnam(sys_get_temp_dir(), 'ii');
	$extracted = $tmp . '-new';
	$backup = $tmp . '-backup';
	file_put_contents($tmp, $body);
	$cleanup = function () use ($tmp, $extracted, $backup) { @unlink($tmp); ii_rrmdir($extracted); ii_rrmdir($backup); };

	$zip = new ZipArchive();
	if ($zip->open($tmp) !== true) { $cleanup(); return array('error' => ii_t('zipUnreadable') . $manual); }
	$hasVersion = false;
	for ($i = 0; $i < $zip->numFiles; $i++) {
		$name = str_replace('\\', '/', $zip->getNameIndex($i));
		if (strpos($name, '..') !== false or substr($name, 0, strlen(II_MODULE) + 1) !== II_MODULE . '/') {
			$zip->close(); $cleanup();
			return array('error' => ii_t('zipRefused', array('name' => $name)));
		}
		if ($name === II_MODULE . '/version.json') $hasVersion = true;
	}
	if (!$hasVersion or !$zip->extractTo($extracted)) { $zip->close(); $cleanup(); return array('error' => ii_t('zipIncomplete') . $manual); }
	$zip->close();

	$new = @json_decode(@file_get_contents($extracted . '/' . II_MODULE . '/version.json'), true);
	if (empty($new['version'])) { $cleanup(); return array('error' => ii_t('versionInvalid')); }

	if (!ii_rcopy($dir, $backup)) { $cleanup(); return array('error' => ii_t('backupFailed') . $manual); }
	if (!ii_rcopy($extracted . '/' . II_MODULE, $dir)) {
		ii_rcopy($backup, $dir);
		$cleanup();
		return array('error' => ii_t('copyFailed') . $manual);
	}
	$cleanup();
	if (function_exists('opcache_reset')) @opcache_reset();
	ii_set_global('updateCheck', array());
	return array('ok' => true, 'version' => $new['version']);
}
