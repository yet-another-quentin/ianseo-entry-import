<?php
/*
 * Import inscriptions — API JSON de la page.
 * Mêmes droits que Partecipants/ListLoad.php ; la mise à jour du module exige les droits administrateur.
 */
require_once(dirname(__FILE__, 4) . '/config.php');
require_once(__DIR__ . '/lib.php');

if (!CheckTourSession()) JsonOut(array('error' => 'Aucune compétition ouverte'));
if (!hasFullACL(AclParticipants, 'pAdvancedEntries', AclReadWrite)) JsonOut(array('error' => 'Droits insuffisants'));

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) $in = $_POST;
$action = $_GET['action'] ?? ($in['action'] ?? '');

try {
	switch ($action) {
		case 'licences':
			JsonOut(array('licences' => ii_lookup_licences($in['codes'] ?? array())));

		case 'search':
			JsonOut(array('results' => ii_search_archers((string)($in['nom'] ?? ''), (string)($in['prenom'] ?? ''))));

		case 'clubs':
			JsonOut(array('clubs' => ii_clubs()));

		case 'parse':
			if (empty($_FILES['file']) or $_FILES['file']['error'] != UPLOAD_ERR_OK) JsonOut(array('error' => 'Fichier non reçu'));
			$ext = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
			if (!in_array($ext, array('xlsx', 'xls', 'ods'))) JsonOut(array('error' => 'Format non pris en charge'));
			$tmp = $_FILES['file']['tmp_name'] . '.' . $ext;
			move_uploaded_file($_FILES['file']['tmp_name'], $tmp);
			try {
				$rows = ii_read_spreadsheet($tmp);
			} finally {
				@unlink($tmp);
			}
			JsonOut(array('rows' => $rows));

		case 'settings':
			// correspondances de la compétition : profil, colonnes, valeurs, options
			ii_set('settings', $in['settings'] ?? new stdClass());
			JsonOut(array('ok' => true));

		case 'correction':
			$key = (string)($in['key'] ?? '');
			if ($key === '') JsonOut(array('error' => 'Clé manquante'));
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
				JsonOut(array('error' => 'Profil invalide'));
			}
			ii_set_global('profiles', $profiles);
			JsonOut(array('ok' => true, 'profiles' => $profiles));

		case 'update-check':
			if (!hasFullACL(AclRoot, '', AclReadWrite)) JsonOut(array('error' => 'Réservé à l\'administrateur'));
			JsonOut(ii_update_check(!empty($in['force'])));

		case 'update-install':
			if (!hasFullACL(AclRoot, '', AclReadWrite)) JsonOut(array('error' => 'Réservé à l\'administrateur'));
			JsonOut(ii_update_install());
	}
	JsonOut(array('error' => 'Action inconnue'));
} catch (Throwable $e) {
	JsonOut(array('error' => $e->getMessage()));
}
