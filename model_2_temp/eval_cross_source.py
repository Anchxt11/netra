import json, numpy as np, pandas as pd, warnings; warnings.filterwarnings("ignore")
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from scipy.sparse import hstack, csr_matrix
b=json.load(open("enterprise-attack.json")); objs=b["objects"]
ext=lambda o: next((r["external_id"] for r in o.get("external_references",[]) if r.get("source_name")=="mitre-attack"),None)
ok=lambda o: not o.get("revoked") and not o.get("x_mitre_deprecated")
tech={ext(o):o for o in objs if o["type"]=="attack-pattern" and ok(o)}
Ya=pd.read_csv("out/Y_attack.csv",index_col=0); Ye=pd.read_csv("out/Y_elastic_human.csv",index_col=0)
T=list(Ya.index); A=list(Ya.columns)
txt=[(tech[t]["name"]+". "+tech[t].get("description","")) for t in T]
meta=[" ".join("tac_"+p["phase_name"] for p in tech[t].get("kill_chain_phases",[]))+" "+" ".join("plat_"+x.replace(" ","_") for x in tech[t].get("x_mitre_platforms",[])) for t in T]
groups=np.array([t.split(".")[0] for t in T])
test_mask=(Ye.sum(axis=1)>0).values            # techniques with >=1 human-Elastic positive
def metrics(S, rows, cols):
    P=[];H=[];M=[]
    for i in rows:
        y=Ye.iloc[i][cols].values; 
        if y.sum()==0: continue
        order=np.argsort(-S[i][[A.index(c) for c in cols]],kind="stable"); top=order[:3]
        P.append(y[top].mean()); H.append(float(y[top].any()))
        r=np.where(y[order]==1)[0][0]+1; M.append(1/r)
    return np.mean(P),np.mean(H),np.mean(M),len(P)
S_ml=np.zeros((len(T),len(A))); 
pop_all=np.zeros((len(T),len(A))); S_lookup=np.zeros((len(T),len(A)))
for tr,te in GroupKFold(n_splits=5).split(T,groups=groups):
    tf=TfidfVectorizer(stop_words="english",min_df=2,max_features=4000,sublinear_tf=True); tm=TfidfVectorizer(token_pattern=r"\S+")
    Xtr=hstack([tf.fit_transform([txt[i] for i in tr]),tm.fit_transform([meta[i] for i in tr])]).tocsr()
    Xte=hstack([tf.transform([txt[i] for i in te]),tm.transform([meta[i] for i in te])]).tocsr()
    pop=Ya.iloc[tr].mean().values
    for j,a in enumerate(A):
        y=Ya.iloc[tr][a].values
        if y.sum()>=3 and y.sum()<len(y)-3:
            m=LogisticRegression(C=4,max_iter=2000,class_weight="balanced").fit(Xtr,y); S_ml[te,j]=m.predict_proba(Xte)[:,1]
        else: S_ml[te,j]=pop[j]*0.01
    pop_all[te]=pop
    S_lookup[te]=Ya.iloc[te].values+1e-3*pop       # direct ATT&CK lookup of the held-out technique (needs a mapping to exist)
rows=np.where(test_mask)[0]
learnable=[a for a in A if Ya[a].sum()>=10]
print(f"eval techniques (>=1 human-Elastic positive): {len(rows)}   | actions ATT&CK can express (>=10 positives): {len(learnable)}/{len(A)}")
for name,cols in (("ALL 20 actions",A),("only actions ATT&CK can express",learnable)):
    print(f"\n--- {name} ---   P@3   Hit@3   MRR")
    for lab,S in (("popularity prior ",pop_all),("direct ATT&CK lookup",S_lookup),("ML (TF-IDF+tactic, LR)",S_ml)):
        p,h,m,n=metrics(S,rows,cols); print(f"{lab:24s} {p:.3f}  {h:.3f}  {m:.3f}")
# techniques ATT&CK has NO mitigation for (the generalization case)
nolab=[i for i in rows if Ya.iloc[i].sum()==0]
print(f"\n--- techniques with NO ATT&CK mitigation but with Elastic labels (n={len(nolab)}): pure generalization ---")
for lab,S in (("popularity prior ",pop_all),("ML (TF-IDF+tactic, LR)",S_ml)):
    p,h,m,n=metrics(S,nolab,learnable); print(f"{lab:24s} {p:.3f}  {h:.3f}  {m:.3f}")
