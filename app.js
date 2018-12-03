console.log(new Date().toTimeString());

const fs = require('fs');
const config = JSON.parse(fs.readFileSync(__dirname + '/config.json'));
const JsonDB = require('node-json-db');
const db = new JsonDB("templates-db", true, true);
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const stringify = require("json-stringify-pretty-compact")

const app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.status(200).send('Hello, create-jira-issue!!').end();
});

app.post('/command/jira', (req, res) => {
    console.log(req.body);
    res.send('');

    const text = req.body.text.trim();
    if (text === 'tem') {
        sendTemplateListMsg(req.body.user_id, req.body.response_url);
    }
    else {
        openTemplateUseDlg(req.body.trigger_id, req.body.user_id);
    }
});

app.post('/interact', (req, res) => {
    console.log(req.body);
    res.send('');

    const body = JSON.parse(req.body.payload);

    if (body.callback_id.startsWith('template_action:')) {
        if (body.actions[0].value === 'edit') {
            openTemplateAddEditDlg(body.trigger_id, getDbTemplate(body.user.id, body.callback_id.split(':')[1]));
        }
        else if (body.actions[0].value === 'delete') {
            deleteTemplate(body.user.id, body.callback_id.split(':')[1]);

            sendTemplateListMsg(body.user.id, body.response_url);
        }
        else if (body.actions[0].value === 'add') {
            openTemplateAddEditDlg(body.trigger_id);
        }
    }
    else if (body.callback_id === 'add_template') {
        updateTemplate(body.user.id, body.submission.name, {
            name: body.submission.name,
            form: JSON.parse(body.submission.form)
        });

        sendTemplateListMsg(body.user.id, body.response_url);
    }
    else if (body.callback_id.startsWith('edit_template:')) {
        updateTemplate(body.user.id, body.callback_id.split(':')[1], {
            name: body.submission.name,
            form: JSON.parse(body.submission.form)
        });

        sendTemplateListMsg(body.user.id, body.response_url);
    }
    else if (body.callback_id === 'msg_action:new_issue') {
        openTemplateUseDlg(body.trigger_id, body.user.id, body.channel.id, body.message.text, body.message.ts);
    }
    else if (body.callback_id === 'use_template') {
        useTemplate(body.user.id, body.submission.template, body.response_url, body.submission.summary, body.submission.description, body.submission.priority);
    }
});

function useTemplate(userId, temName, responseUrl, summary, description, priority) {
    let setCookie = '';
    const form = getDbTemplate(userId, temName).form;
    let slackJiraUsers = {};
    let issuetypes = [];
    let priorities = [];
    let components = [];
    let createdIssueKey;
    loginJira()
        .then(res => {
            setCookie = res.headers['set-cookie'].join(';');
            return getSlackJiraUsers(setCookie);
        })
        .then(res => {
            slackJiraUsers = res;
            return getIssuetypes(setCookie);
        })
        .then(res => {
            issuetypes = res.data;
            return getPriorities(setCookie);
        })
        .then(res => {
            priorities = res.data;
            return getComponents(setCookie);
        })
        .then(res => {
            components = res.data;
            return createIssue(setCookie, makeCreateIssuePayload(userId, issuetypes, priorities, components, form, summary, description, priority, slackJiraUsers));
        })
        .then(res => {
            createdIssueKey = res.data.key;
            console.log('before send msg');
            // return doIssueTransition(setCookie, createdIssueKey, makeIssueTransitionPayload(saveData.platform));
            return sendMsg(responseUrl, makeIssueCreatedMsgPayload(createdIssueKey));
        })
        .then(res => console.log(res.data))
        .catch(err => {
            console.log(err.toString());
            try {
                console.log(JSON.stringify(err.response.data.errors));
            } catch (e) {
                // Ignore.
            }
        });
}

function getDbTemplates(userId) {
    try {
        return db.getData('/' + userId + '/templates');
    }
    catch (e) {
        return {};
    }
}

function getDbTemplate(userId, name) {
    try {
        return db.getData('/' + userId + '/templates/' + name);
    }
    catch (e) {
        return {};
    }
}

function setDbTemplates(userId, templates) {
    db.push('/' + userId + '/templates', templates);
}

function updateTemplate(userId, name, template) {
    const templates = getDbTemplates(userId);
    delete templates[name];
    templates[template.name] = template;
    setDbTemplates(userId, templates);
}

function deleteTemplate(userId, name) {
    const templates = getDbTemplates(userId);
    delete templates[name];
    setDbTemplates(userId, templates);
}


/*SLACK*/
function makeTemplateListMsgPayload(templates) {
    const json = {
        text: '지라이슈 생성 템플릿',
        attachments: []
    };
    for (const key in templates) {
        const template = templates[key];

        json.attachments.push({
            title: template.name,
            callback_id: 'template_action:' + template.name,
            color: '#35c5f0',
            "actions": [
                {
                    "name": "action",
                    "text": "---edit---",
                    "type": "button",
                    "value": "edit"
                },
                {
                    "name": "action",
                    "text": "---delete---",
                    "style": "danger",
                    "type": "button",
                    "value": "delete",
                    "confirm": {
                        "title": "재확인",
                        "text": "정말 삭제하세요?",
                        "ok_text": "네",
                        "dismiss_text": "아니오"
                    }
                }
            ]
        });
    }

    json.attachments.push({
        title: null,
        callback_id: 'template_action:',
        color: '#35c5f0',
        "actions": [
            {
                "name": "action",
                "text": "---add---",
                'style': 'primary',
                "type": "button",
                "value": "add"
            }
        ]
    })
    return json;
}

function makeTemplateAddEditDlgPayload(template) {
    const json = {
        callback_id: template == null ? 'add_template' : 'edit_template:' + template.name,
        title: template == null ? '새 템플릿' : '템플릿 수정',
        submit_label: '저장',
        elements: [
            {
                type: 'text',
                label: '이름',
                name: 'name',
                value: template == null ? null : template.name,
                optional: false
            },
            {
                type: 'textarea',
                label: '양식',
                name: 'form',
                hint: '슬래시(/)로 구분된 값은 하나만 선택, 쉼표(,)로 구분된 값은 여러 개 입력 가능',
                value: template != null ? stringify(template.form) : stringify(config.default_template),
                optional: false
            }
        ]
    };
    return json;
}

function makeTemplateUseDlgPayload(priorities, templates, channelId, msg, msgTs) {
    let summary = '';
    let description = '';
    if (msg) {
        summary = msg.replace(/\n/g, ' ').substr(0, 100);
        description += '\nh2. 슬랙 메시지 링크 \n\n' + config.slack.domain + '/archives/' + channelId + '/p' + msgTs.replace('.', '');
    }

    let templateOptions = [];
    for (const key in templates) {
        const template = templates[key];
        templateOptions.push({"label": template.name, "value": template.name})
    }

    let priorityOptions = [];
    for (const idx in priorities) {
        const priority = priorities[idx];
        priorityOptions.push({"label": priority.name, "value": priority.name})
    }

    const json = {
        callback_id: 'use_template',
        title: '템플릿으로 지라이슈 만들기',
        submit_label: '만들기',
        elements: [
            {
                type: 'text',
                label: '제목(summary)',
                name: 'summary',
                value: summary,
                optional: true,
                hint: '비어있으면 템플릿에 있는 값으로 들어갑니다.'
            },
            {
                type: 'textarea',
                label: '설명(description)',
                name: 'description',
                value: description,
                optional: true,
                hint: '비어있으면 템플릿에 있는 값으로 들어갑니다.'
            },
            {
                type: 'select',
                label: '우선순위(priority)',
                name: 'priority',
                value: null,
                options: priorityOptions,
                optional: true,
                hint: '비어있으면 템플릿에 있는 값으로 들어갑니다.'
            },
            {
                type: 'select',
                label: '템플릿',
                name: 'template',
                value: null,
                options: templateOptions,
                optional: false
            }
        ]
    };
    return json;
}

function makeIssueCreatedMsgPayload(issueKey) {
    const json = {
        text: 'new issue : ' + config.jira.server_domain + '/browse/' + issueKey
    };
    return json;
}

function sendTemplateListMsg(userId, responseUrl) {
    const templates = getDbTemplates(userId);
    sendMsg(responseUrl, makeTemplateListMsgPayload(templates))
        .then(res => console.log(res.data))
        .catch(err => console.log(err.toString()));
}

function sendMsg(responseUrl, payload) {
    payload.as_user = true;
    return axios
        .post(responseUrl ? responseUrl : 'https://slack.com/api/chat.postMessage', JSON.stringify(payload), {
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + config.slack.bot_access_token
            }
        });
}

function openTemplateAddEditDlg(triggerId, template = null) {
    openDlg(triggerId, makeTemplateAddEditDlgPayload(template))
        .then(res => console.log(res.data))
        .catch(err => console.log(err.toString()));
}

function openTemplateUseDlg(triggerId, userId, channelId, msg, msgTs) {
    let setCookie = '';
    let priorities = [];
    loginJira()
        .then(res => {
            setCookie = res.headers['set-cookie'].join(';');
            return getPriorities(setCookie);
        })
        .then(res => {
            priorities = res.data;
            return openDlg(triggerId, makeTemplateUseDlgPayload(priorities, getDbTemplates(userId), channelId, msg, msgTs));
        })
        .then(res => console.log(res.data))
        .catch(err => console.log(err.toString()));
}

function openDlg(triggerId, payload) {
    console.log(JSON.stringify(payload));
    return axios
        .post('https://slack.com/api/dialog.open',
            JSON.stringify({
                trigger_id: triggerId,
                dialog: JSON.stringify(payload)
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + config.slack.bot_access_token
                }
            }
        );
}

function getSlackUsers() {
    return axios
        .get('https://slack.com/api/users.list', {
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + config.slack.bot_access_token
            }
        })
        .then(res => {
            const liveSlackUsers = res.data.members.filter(member => {
                if (member.deleted || member.is_bot || member.id === 'USLACKBOT' || member.is_restricted) {
                    return false;
                }
                return true;
            });
            return new Promise(resolve => resolve(liveSlackUsers));
        })
}

function getSlackJiraUsers(setCookie) {
    let slackUsers;
    let jiraUsers;
    return getSlackUsers()
        .then(res => {
            slackUsers = res;
            return getJiraUsers(setCookie);
        })
        .then(res => {
            jiraUsers = res.data.values;

            const slackJiraUsers = {};
            slackUsers.forEach(slackUser => {
                for (const idx in  jiraUsers) {
                    const jiraUser = jiraUsers[idx];
                    if (slackUser.profile.display_name === jiraUser.displayName) {
                        slackJiraUsers[slackUser.profile.display_name] = {slackUser, jiraUser};
                        break;
                    }
                }
            });
            return new Promise(resolve => resolve(slackJiraUsers));
        })


    /*TODO
    * JIRA API Types, Priorities, Compomenets, Status, 다 받아서 매치시켜서 처리해야 함.
    *
    * */
}


/*JIRA*/
function loginJira() {
    return axios.post(config.jira.server_domain + '/rest/auth/1/session',
        JSON.stringify({
            username: config.jira.username,
            password: config.jira.password
        }),
        {
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );
}

function getJiraUsers(setCookie) {
    return axios.get(config.jira.server_domain + '/rest/api/2/group/member?groupname=jira-software-users',
        {
            headers: {
                'Cookie': setCookie,
                'Content-Type': 'application/json'
            }
        }
    );
}

function getIssuetypes(setCookie) {
    return axios.get(config.jira.server_domain + '/rest/api/2/issuetype', {
        headers: {
            'Cookie': setCookie,
            'Content-Type': 'application/json'
        }
    });
}

function getPriorities(setCookie) {
    return axios.get(config.jira.server_domain + '/rest/api/2/priority', {
        headers: {
            'Cookie': setCookie,
            'Content-Type': 'application/json'
        }
    });
}

function getComponents(setCookie) {
    return axios.get(config.jira.server_domain + '/rest/api/2/project/10400/components', {
        headers: {
            'Cookie': setCookie,
            'Content-Type': 'application/json'
        }
    });
}

function createIssue(setCookie, data) {
    return axios.post(config.jira.server_domain + '/rest/api/2/issue', JSON.stringify(data), {
        headers: {
            'Cookie': setCookie,
            'Content-Type': 'application/json'
        }
    });
}

function doIssueTransition(setCookie, issueKey, data) {
    return axios.post(config.jira.server_domain + '/rest/api/2/issue/' + issueKey + '/transitions', JSON.stringify(data), {
        headers: {
            'Cookie': setCookie,
            'Content-Type': 'application/json'
        }
    });
}

function makeCreateIssuePayload(userId, issuetypes, priorities, components, form, summary, description, priority, slackJiraUsers) {
    let assignee;
    let reporter;
    let watchers = [];
    for (const key in slackJiraUsers) {
        const slackJiraUser = slackJiraUsers[key];
        if (form.assignee === slackJiraUser.slackUser.profile.display_name) {
            assignee = slackJiraUser.jiraUser.name;
        }
        if (userId === slackJiraUser.slackUser.id) {
            reporter = slackJiraUser.jiraUser.name;
        }
        if (form.watchers.some(watcher => watcher === slackJiraUser.slackUser.profile.display_name)) {
            watchers.push({name: slackJiraUser.jiraUser.name});
        }
    }

    const json = {
        "fields": {
            "project": {"id": "10400"/*OK-KANBAN*/},
            "issuetype": {"id": issuetypes.find(issuetype => issuetype.name === form.issuetype).id},
            "summary": form.components.reduce((res, commponent) => {
                if (!res.includes('[')) {
                    res = '[' + res + ']';
                }
                return res + '[' + commponent + ']';
            }) + ' ' + (summary ? summary : form.summary),
            "assignee": {"name": assignee},
            "reporter": {"name": reporter},
            "priority": {"id": priorities.find(p => p.name === (priority ? priority : form.priority)).id},
            "description": description ? description : form.description,
            "components": components.filter(c => form.components.some(fc => fc === c.name)).map(c => {
                return {id: c.id}
            }),
            "customfield_10904"/*WATCHERS*/: watchers,
            "labels": form.labels,
        }
    };
    console.log(JSON.stringify(json));
    return json;
}

function makeIssueTransitionPayload(platform) {
    const json = {
        "transition": platform.transition + ""
    };
    return json;
}


// Start the server
const PORT = process.env.PORT || 13000;
// const PORT = process.env.PORT || 55000;
app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});