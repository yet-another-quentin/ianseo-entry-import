<?php
/*
 * Import inscriptions — fonctions PHP communes à la page et à l'API.
 * Le module n'écrit jamais dans les tables d'IANSEO (Entries, Qualifications…) :
 * l'import lui-même est délégué à Partecipants/ListLoad.php.
 */

require_once('Common/Lib/Fun_Modules.php');

const II_MODULE = 'ImportInscriptions';

function ii_version_info() {
	$v = @json_decode(@file_get_contents(__DIR__ . '/version.json'), true);
	return is_array($v) ? $v : array('version' => '0.0.0', 'repo' => '', 'asset' => 'ImportInscriptions.zip');
}

// ---------- paramètres ----------
// Valeurs stockées en JSON (chaîne) pour ne jamais désérialiser d'objets PHP.

function ii_get($param, $default = null) {
	$v = getModuleParameter(II_MODULE, $param, '');
	if ($v === '' or $v === null) return $default;
	$d = json_decode($v, true);
	return $d === null ? $default : $d;
}

function ii_set($param, $value) {
	setModuleParameter(II_MODULE, $param, json_encode($value, JSON_UNESCAPED_UNICODE));
}

// Paramètres communs à toute l'installation (profils, cache de mise à jour) : MpTournament = 0.
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

// ---------- contexte de la compétition ouverte ----------

function ii_tournament() {
	$q = safe_r_sql("select ToIocCode, ToWhenFrom, ToWhenTo from Tournament where ToId=" . intval($_SESSION['TourId']));
	return safe_fetch($q);
}

function ii_context() {
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
		'tour' => array('name' => $_SESSION['TourName'], 'ioc' => $tour->ToIocCode, 'from' => $tour->ToWhenFrom, 'to' => $tour->ToWhenTo),
		'sessions' => $sessions,
		'divisions' => $divisions,
		'classes' => $classes,
		'lookupCount' => $lookupCount,
		'settings' => ii_get('settings', new stdClass()),
		'corrections' => ii_get('corrections', new stdClass()),
		'profiles' => ii_get_global('profiles', array()),
		'isAdmin' => hasFullACL(AclRoot, '', AclReadWrite),
		'version' => $version['version'],
		'listLoadUrl' => $GLOBALS['CFG']->ROOT_DIR . 'Partecipants/ListLoad.php',
		'syncUrl' => $GLOBALS['CFG']->ROOT_DIR . 'Partecipants/LookupTableLoad.php',
	);
}

// ---------- base des licences ----------

function ii_status_label($status) {
	$t = get_text('Status_' . intval($status));
	return $t ? strip_tags($t) : ('Statut ' . intval($status));
}

/**
 * Recherche des licences, avec la même requête que Partecipants/ListLoad.php
 * (LueCode exact + code du tournoi, ORDER BY LueDefault DESC) : ce que voit le module est ce que verra l'import.
 * Validité calculée comme Partecipants/SearchArcher.php (statut 5 si la licence expire avant le concours).
 */
function ii_lookup_licences($codes) {
	$tour = ii_tournament();
	$TourId = intval($_SESSION['TourId']);
	$out = array();
	$codes = array_values(array_unique(array_filter(array_map(function ($c) {
		return strtoupper(preg_replace('/[\s.\-]/', '', (string)$c));
	}, (array)$codes))));
	if (!$codes) return $out;
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
				'nom' => $r->LueFamilyName,
				'prenom' => $r->LueName,
				'sex' => intval($r->LueSex) ? 'F' : 'H',
				'club' => $r->LueCoShort ?: $r->LueCoDescr,
				'clubCode' => $r->LueCountry,
				'division' => $r->LueDivision,
				'classe' => $r->LueClass,
				'naissance' => ($r->LueCtrlCode and $r->LueCtrlCode != '0000-00-00') ? $r->LueCtrlCode : '',
				'status' => $status,
				'statusLabel' => ii_status_label($status),
				'valid' => in_array($status, array(0, 1)),
				'entries' => array(),
			);
		}

		// archers déjà présents dans la compétition (information seulement)
		$q = safe_r_sql("select EnCode, EnDivision, QuSession from Entries inner join Qualifications on QuId=EnId
			where EnTournament=$TourId and EnCode in ($in) order by QuSession");
		while ($r = safe_fetch($q)) {
			$code = strtoupper($r->EnCode);
			if (isset($out[$code])) $out[$code]['entries'][] = array('session' => intval($r->QuSession), 'division' => $r->EnDivision);
		}
	}
	return $out;
}

// Recherche par nom (pour retrouver la bonne licence d'un archer).
function ii_search_archers($nom, $prenom) {
	$tour = ii_tournament();
	$res = array();
	$tries = array(array($nom, $prenom), array($nom, ''));
	foreach ($tries as $t) {
		if (trim($t[0]) === '') continue;
		$sql = "select LueCode, LueFamilyName, LueName, LueSex, LueCoShort, LueCoDescr, LueCtrlCode, LueDivision, LueClass from LookUpEntries
			where LueIocCode=" . StrSafe_DB($tour->ToIocCode) . " and LueFamilyName like " . StrSafe_DB(trim($t[0]) . '%');
		if (trim($t[1]) !== '') $sql .= " and LueName like " . StrSafe_DB(trim($t[1]) . '%');
		$q = safe_r_sql($sql . " order by LueFamilyName, LueName limit 20");
		while ($r = safe_fetch($q)) {
			$res[$r->LueCode] = array(
				'licence' => $r->LueCode, 'nom' => $r->LueFamilyName, 'prenom' => $r->LueName,
				'sex' => intval($r->LueSex) ? 'F' : 'H', 'club' => $r->LueCoShort ?: $r->LueCoDescr,
				'naissance' => ($r->LueCtrlCode and $r->LueCtrlCode != '0000-00-00') ? $r->LueCtrlCode : '',
				'division' => $r->LueDivision, 'classe' => $r->LueClass,
			);
		}
		if ($res) break;
	}
	return array_values($res);
}

// Clubs connus (base des licences + clubs déjà dans la compétition), pour l'import sans base.
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

// ---------- lecture des fichiers Excel / ODS (PhpSpreadsheet fourni avec IANSEO) ----------

function ii_read_spreadsheet($path) {
	global $CFG;
	require_once($CFG->DOCUMENT_PATH . 'Common/vendor/autoload.php');
	$book = \PhpOffice\PhpSpreadsheet\IOFactory::load($path);
	$rows = $book->getActiveSheet()->toArray('', true, true, false);
	return array_values(array_filter($rows, function ($r) {
		foreach ($r as $v) if (trim((string)$v) !== '') return true;
		return false;
	}));
}

// ---------- mise à jour depuis GitHub ----------

function ii_http_get($url, $accept = '*/*') {
	$ua = 'IANSEO-ImportInscriptions';
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
		if ($body === false) return array(0, '', $err ?: 'connexion impossible');
		return array($code, $body, $code >= 400 ? "HTTP $code" : '');
	}
	$ctx = stream_context_create(array('http' => array(
		'header' => "User-Agent: $ua\r\nAccept: $accept\r\n", 'timeout' => 60, 'ignore_errors' => true, 'follow_location' => 1,
	)));
	$body = @file_get_contents($url, false, $ctx);
	if ($body === false) return array(0, '', 'connexion impossible (curl absent, allow_url_fopen ou SSL ?)');
	$code = 0;
	if (!empty($http_response_header)) {
		foreach ($http_response_header as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = intval($m[1]);
	}
	return array($code, $body, $code >= 400 ? "HTTP $code" : '');
}

function ii_update_check($force = false) {
	$info = ii_version_info();
	$cache = ii_get_global('updateCheck', array());
	if (!$force and !empty($cache['at']) and time() - $cache['at'] < 86400 and ($cache['current'] ?? '') === $info['version']) {
		return $cache;
	}
	$res = array('at' => time(), 'current' => $info['version'], 'latest' => '', 'notes' => '', 'asset' => '', 'url' => '', 'error' => '');
	if (empty($info['repo'])) {
		$res['error'] = 'Dépôt non configuré';
	} else {
		// `api` (facultatif dans version.json) permet de tester avec un faux serveur de releases
		$api = rtrim($info['api'] ?? 'https://api.github.com', '/');
		list($code, $body, $err) = ii_http_get($api . '/repos/' . $info['repo'] . '/releases/latest', 'application/vnd.github+json');
		$j = $err ? null : json_decode($body, true);
		if (!$j or empty($j['tag_name'])) {
			$res['error'] = $err ?: 'réponse GitHub inattendue';
		} else {
			$res['latest'] = ltrim($j['tag_name'], 'vV');
			$res['notes'] = (string)($j['body'] ?? '');
			$res['url'] = (string)($j['html_url'] ?? '');
			foreach ((array)($j['assets'] ?? array()) as $a) {
				if (($a['name'] ?? '') === $info['asset']) $res['asset'] = $a['browser_download_url'];
			}
		}
	}
	$res['available'] = ($res['latest'] !== '' and $res['asset'] !== '' and version_compare($res['latest'], $info['version'], '>'));
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
 * Installe la dernière release. L'ancienne version est copiée dans ImportInscriptions.bak/ ;
 * en cas d'échec à n'importe quelle étape, elle est remise en place.
 */
function ii_update_install() {
	$check = ii_update_check(true);
	if (!$check['available']) return array('error' => $check['error'] ?: 'Aucune nouvelle version');
	$manual = ' — Mise à jour manuelle : télécharger ' . $check['asset'] . ' et décompresser son contenu dans Modules/Custom/.';
	if (!class_exists('ZipArchive')) return array('error' => "Extension PHP « zip » absente" . $manual);

	$dir = __DIR__;
	$bak = dirname($dir) . DIRECTORY_SEPARATOR . II_MODULE . '.bak';
	if (!is_writable($dir) or !is_writable(dirname($dir))) return array('error' => 'Dossier du module non modifiable par le serveur web' . $manual);

	list($code, $body, $err) = ii_http_get($check['asset'], 'application/octet-stream');
	if ($err or !$body) return array('error' => 'Téléchargement impossible : ' . $err . $manual);

	$tmpZip = tempnam(sys_get_temp_dir(), 'ii');
	$tmpDir = $tmpZip . '-x';
	file_put_contents($tmpZip, $body);
	$cleanup = function () use ($tmpZip, $tmpDir) { @unlink($tmpZip); ii_rrmdir($tmpDir); };

	$zip = new ZipArchive();
	if ($zip->open($tmpZip) !== true) { $cleanup(); return array('error' => 'Archive illisible' . $manual); }
	$hasVersion = false;
	for ($i = 0; $i < $zip->numFiles; $i++) {
		$name = str_replace('\\', '/', $zip->getNameIndex($i));
		if (strpos($name, '..') !== false or substr($name, 0, strlen(II_MODULE) + 1) !== II_MODULE . '/') {
			$zip->close(); $cleanup();
			return array('error' => "Archive refusée : chemin inattendu « $name »");
		}
		if ($name === II_MODULE . '/version.json') $hasVersion = true;
	}
	if (!$hasVersion or !$zip->extractTo($tmpDir)) { $zip->close(); $cleanup(); return array('error' => 'Archive incomplète' . $manual); }
	$zip->close();

	$new = @json_decode(@file_get_contents($tmpDir . '/' . II_MODULE . '/version.json'), true);
	if (empty($new['version'])) { $cleanup(); return array('error' => 'version.json invalide dans l\'archive'); }

	ii_rrmdir($bak);
	if (!ii_rcopy($dir, $bak)) { $cleanup(); ii_rrmdir($bak); return array('error' => 'Sauvegarde impossible' . $manual); }
	if (!ii_rcopy($tmpDir . '/' . II_MODULE, $dir)) {
		ii_rcopy($bak, $dir);
		$cleanup();
		return array('error' => 'Copie des nouveaux fichiers impossible : ancienne version restaurée' . $manual);
	}
	$cleanup();
	if (function_exists('opcache_reset')) @opcache_reset();
	ii_set_global('updateCheck', array());
	return array('ok' => true, 'version' => $new['version']);
}
