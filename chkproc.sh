daemon=`netstat -tlnp | grep :::13000 | wc -l`
if [ "$daemon" -eq "0" ] ; then
        nohup node /home/bsscco/create-jira-issue/app.js &
fi