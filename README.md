# jiraint
지라 통합

### 기술 및 환경
WebStorm, Node, Express, Axios, GCP Compute Engine, crontab, Slack API, Jira API

### 프로그램이 죽어도 재실행 되게 만들기
```
$ chmod 777 chkproc.sh
$ crontab -e
$ * * * * * /home/bsscco/jiraint/chkproc.sh > /home/bsscco/jiraint/crontab-chkproc.log 2>&1
```

### crontab 예약
```
$ crontab -e
```