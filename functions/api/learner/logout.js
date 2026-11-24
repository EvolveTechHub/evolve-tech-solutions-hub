import {clearLearnerCookie,learnerJson} from "../../lib/learner-auth.js";
export async function onRequestPost(){return learnerJson({ok:true},200,{"set-cookie":clearLearnerCookie()});}
