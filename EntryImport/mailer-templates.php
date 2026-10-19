<?php
/*
 * Email templates of the entry import module, discovered by the Mailer module (Modules/Custom/Mailer) when it is
 * installed. Format: see Mailer/mailer-templates.php. The organiser can customise them per competition.
 */
return array(
	'entryimport.proposal' => array(
		'name' => array('fr' => 'Départ complet : proposition d\'un autre départ', 'en' => 'Full session: another session proposed'),
		'description' => array(
			'fr' => 'Envoyé depuis l\'import des inscriptions à un archer inscrit sur un départ complet, pour lui proposer un autre départ.',
			'en' => 'Sent from the entry import to an archer registered for a full session, to propose another session.',
		),
		'to' => 'archer',
		'vars' => array(
			'archer.firstName' => array('fr' => 'Prénom de l\'archer', 'en' => 'Archer\'s first name'),
			'archer.lastName' => array('fr' => 'Nom de l\'archer', 'en' => 'Archer\'s last name'),
			'archer.license' => array('fr' => 'Licence', 'en' => 'License'),
			'category' => array('fr' => 'Arme et catégorie', 'en' => 'Bow type and category'),
			'requestedSession' => array('fr' => 'Départ demandé (complet)', 'en' => 'Requested session (full)'),
			'proposedSession' => array('fr' => 'Départ proposé', 'en' => 'Proposed session'),
			'deadline' => array('fr' => 'Date limite de réponse', 'en' => 'Answer deadline'),
		),
		'sample' => array(
			'archer.firstName' => 'Jean', 'archer.lastName' => 'DUPONT', 'archer.license' => '123456A',
			'category' => array('fr' => 'CL S1H', 'en' => 'CL S1H'),
			'requestedSession' => array('fr' => 'Départ 1 – Samedi matin – samedi 31 octobre 2026 à 10:00', 'en' => 'Session 1 – Saturday morning – Saturday 31 October 2026 at 10:00'),
			'proposedSession' => array('fr' => 'Départ 2 – Samedi après-midi – samedi 31 octobre 2026 à 15:00', 'en' => 'Session 2 – Saturday afternoon – Saturday 31 October 2026 at 15:00'),
			'deadline' => array('fr' => 'jeudi 22 octobre 2026', 'en' => 'Thursday 22 October 2026'),
		),
		'subject' => array(
			'fr' => 'Départ complet : proposition d\'un autre départ – {competition.name}',
			'en' => 'Full session: another session proposed – {competition.name}',
		),
		'body' => array(
			'fr' => "Bonjour {archer.firstName},\n\n"
				. "Merci pour votre inscription à **{competition.name}** ({competition.dates}). Malheureusement, le départ que vous avez choisi est complet :\n{requestedSession}\n\n"
				. "Nous pouvons vous proposer ce départ :\n**{proposedSession}**\n\n"
				. "Merci de nous répondre avant le **{deadline}** en répondant à cet email : acceptez-vous ce départ ? Sans réponse de votre part, la place sera proposée à un autre archer.\n\n"
				. "- Licence : {archer.license}\n- Arme et catégorie : {category}\n\n"
				. "Sportivement,\n{competition.contactName}",
			'en' => "Hello {archer.firstName},\n\n"
				. "Thank you for registering for **{competition.name}** ({competition.dates}). Unfortunately, the session you chose is full:\n{requestedSession}\n\n"
				. "We can offer you this session:\n**{proposedSession}**\n\n"
				. "Please answer before **{deadline}** by replying to this email: do you accept this session? Without an answer, the place will be offered to another archer.\n\n"
				. "- License: {archer.license}\n- Bow type and category: {category}\n\n"
				. "Best regards,\n{competition.contactName}",
		),
	),
);
