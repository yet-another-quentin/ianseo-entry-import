#!/bin/sh
# Prepares the test IANSEO started by docker-compose.yml: schema, a French indoor competition "TEST26"
# (4 sessions of 36 places, para divisions) and fictitious licenses matching tests/fixtures/sportregions.csv.
# Usage: IANSEO_DIR=/path/to/ianseo-copy ./seed.sh   (from the dev/ folder, containers running)
set -e
: "${IANSEO_DIR:?copy of the IANSEO sources}"
cd "$(dirname "$0")"
URL=${URL:-http://localhost:8088}
sql() { docker compose exec -T db mariadb -uianseo -pianseo ianseo "$@"; }

until sql -e 'select 1' >/dev/null 2>&1; do sleep 1; done
if ! sql -e 'show tables like "Tournament"' | grep -q Tournament; then
  sql < "$IANSEO_DIR/Install/install.sql"
fi

# IANSEO upgrades its schema when its home page is first opened
curl -s -o /dev/null "$URL/"

jar=$(mktemp)
curl -s -c "$jar" -b "$jar" -o /dev/null "$URL/Tournament/index.php?New=1"
curl -s -c "$jar" -b "$jar" -o /dev/null "$URL/Tournament/index.php?New=1" \
  --data-urlencode 'Command=SAVE' --data-urlencode 'd_ToCode=TEST26' --data-urlencode 'd_ToName=Tir salle Cestas (test)' \
  --data-urlencode 'd_ToCommitee=0333333' --data-urlencode 'd_ToComDescr=Archers de Cestas' --data-urlencode 'd_ToWhere=Cestas' \
  --data-urlencode 'd_Rule=FR' --data-urlencode 'd_ToType=6' --data-urlencode 'd_SubRule=4' --data-urlencode 'd_ToCountry=FRA' \
  --data-urlencode 'd_ToTimeZone=+01:00' --data-urlencode 'd_ToIocCode=FRA' \
  --data-urlencode 'xx_ToWhenFromYear=2026' --data-urlencode 'xx_ToWhenFromMonth=10' --data-urlencode 'xx_ToWhenFromDay=31' \
  --data-urlencode 'xx_ToWhenToYear=2026' --data-urlencode 'xx_ToWhenToMonth=11' --data-urlencode 'xx_ToWhenToDay=01'
rm -f "$jar"

sql <<'SQL'
set @t = (select max(ToId) from Tournament where ToCode='TEST26');
update Tournament set ToIocCode='FRA', ToNumSession=4 where ToId=@t;
delete from Session where SesTournament=@t;
insert into Session (SesTournament,SesOrder,SesType,SesName,SesTar4Session,SesAth4Target,SesFirstTarget,SesStatus,SesDtStart,SesDtEnd,SesOdfCode,SesOdfPeriod,SesOdfVenue,SesOdfLocation,SesLocation) values
 (@t,1,'Q','Samedi matin',18,2,1,'','2026-10-31 10:00','2026-10-31 13:00','','','','',''),
 (@t,2,'Q','Samedi après-midi',18,2,1,'','2026-10-31 15:00','2026-10-31 18:00','','','','',''),
 (@t,3,'Q','Dimanche matin',18,2,1,'','2026-11-01 10:00','2026-11-01 13:00','','','','',''),
 (@t,4,'Q','Dimanche après-midi',18,2,1,'','2026-11-01 15:00','2026-11-01 18:00','','','','','');
delete from LookUpEntries where LueIocCode='FRA' and LueCode in ('123456A','654321B','222222D','333333E','444444F','555555G');
insert into LookUpEntries (LueCode,LueIocCode,LueFamilyName,LueName,LueSex,LueClassified,LueCtrlCode,LueCountry,LueCoDescr,LueCoShort,LueCountry2,LueCoDescr2,LueCoShort2,LueCountry3,LueCoDescr3,LueCoShort3,LueDivision,LueClass,LueSubClass,LueStatus,LueStatusValidUntil,LueDefault,LueNameOrder) values
 ('123456A','FRA','DUPONT','Jean',0,0,'1985-03-12','0333001','Archers de Cestas','ARC CESTAS','','','','','','','CL','S1H','',0,'2027-08-31',1,0),
 ('654321B','FRA','MARTIN','Elodie',1,0,'2010-02-01','0333002','Archers de Pessac','ARC PESSAC','','','','','','','CO','U18F','',0,'2027-08-31',1,0),
 ('222222D','FRA','ROUX','Marc',0,0,'1970-05-05','0333003','Club Z','CLUB Z','','','','','','','CL','S2H','',0,'2027-08-31',1,0),
 ('333333E','FRA','AUTRE','Personne',0,0,'1980-01-01','0333004','Club X','CLUB X','','','','','','','CL','S1H','',0,'2027-08-31',1,0),
 ('444444F','FRA','ATTENTE','Zoé',1,0,'2000-03-12','0333004','Club X','CLUB X','','','','','','','CL','S1F','',0,'2026-09-01',1,0),
 ('555555G','FRA','DURAND','Paul',0,0,'1960-01-01','0333005','Club Durand','CLUB D','','','','','','','BB','S3H','',0,'2027-08-31',1,0);
select ToId, ToCode, ToLocRule, ToIocCode from Tournament where ToId=@t;
SQL
