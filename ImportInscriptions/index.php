<?php
/*
 * Import inscriptions (CSV/Excel) — page du module.
 * Le fichier est analysé dans le navigateur (core.js / app.js) ; les lignes validées sont envoyées
 * à Partecipants/ListLoad.php, qui fait l'import et affiche son propre compte rendu.
 */
require_once(dirname(__FILE__, 4) . '/config.php');
require_once(__DIR__ . '/lib.php');

CheckTourSession(true);
checkFullACL(AclParticipants, 'pAdvancedEntries', AclReadWrite);

$PAGE_TITLE = 'Import inscriptions';
$JS_SCRIPT = array(
	'<link href="./style.css" rel="stylesheet" type="text/css">',
	'<script src="./core.js"></script>',
	'<script src="./app.js" defer></script>',
	'<script>window.II_CONTEXT = ' . json_encode(ii_context(), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) . ';</script>',
);

include('Common/Templates/head.php');
?>
<div id="ii-app">
	<noscript>JavaScript est nécessaire pour ce module.</noscript>
</div>
<?php
include('Common/Templates/tail.php');
