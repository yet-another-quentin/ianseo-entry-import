<?php
/*
 * Entry import (CSV/Excel) — module page.
 * The file is analysed in the browser (core.js / app.js); ready lines are posted to Partecipants/ListLoad.php,
 * which performs the import and shows its own report.
 */
require_once(dirname(__FILE__, 4) . '/config.php');
require_once(__DIR__ . '/lib.php');

CheckTourSession(true);
checkFullACL(AclParticipants, 'pAdvancedEntries', AclReadWrite);

$PAGE_TITLE = ii_t('menu');
$JS_SCRIPT = array(
	'<link href="./style.css" rel="stylesheet" type="text/css">',
	'<script src="./core.js"></script>',
	'<script src="./i18n.js"></script>',
	'<script src="./app.js" defer></script>',
	'<script>window.II_CONTEXT = ' . json_encode(ii_context(), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) . ';</script>',
);

include('Common/Templates/head.php');
?>
<div id="ii-app">
	<noscript>JavaScript is required for this module.</noscript>
</div>
<?php
include('Common/Templates/tail.php');
