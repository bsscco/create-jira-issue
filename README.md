# create-jira-issue
지라 이슈 템플릿으로 만들기

### 기술 및 환경
WebStorm, Node, Express, Axios, GCP Compute Engine, crontab, Slack API, Jira API

### 프로그램이 죽어도 재실행 되게 만들기
```
$ chmod 777 chkproc.sh
$ crontab -e
$ * * * * * /home/bsscco/create-jira-issue/chkproc.sh > /home/bsscco/create-jira-issue/crontab-chkproc.log 2>&1
```

### crontab 예약
```
$ crontab -e
```