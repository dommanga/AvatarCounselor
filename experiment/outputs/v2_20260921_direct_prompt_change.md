# Stage2 v2 — contrastive example x temp sweep  (20260921_135344)
model=gpt-4o  stage1_temp=0.0  stage2_temps=[0.3]
config fixed = TRq (transcript on, full rating on, quote off)


## p1_q1
scores: situation=3, task_and_action=4, result=2  →  **strong = TASK_AND_ACTION / weak = RESULT**

### temp 0.3
- **direct**: GROUNDING: Strength (task/action) — 지원자는 각 방법이 시간을 얼마나 쓰게 되는지 보여주는 간단한 표를 만들어 단체 채팅방에 공유했다고 말함. Weakness (result) — "결과적으로는 그럭저럭 괜찮았던 것 같다"고만 했고 구체적인 내용이 없음.

FEEDBACK: 팀원들과의 의견 차이를 해결하기 위해 시간을 비교하는 표를 만들어 공유한 것은 매우 효과적인 접근이었어요. 하지만 결과가 모호해요. "그럭저럭 괜찮았다"는 표현만으로는 어떤 변화가 있었는지 알기 어려워요. 실험 결과가 어떻게 나왔는지, 팀의 결정이 프로젝트에 어떤 영향을 미쳤는지 구체적으로 설명해 주세요.


## p1_q2'
scores: situation=3, task_and_action=2, result=3  →  **strong = SITUATION / weak = TASK_AND_ACTION**

### temp 0.3
- **direct**: GROUNDING: Strength (situation) — 지원자는 연구실에서 사람마다 샘플 전처리를 다르게 해서 결과가 일관되지 않는 상황을 설명함. Weakness (task/action) — 프로토콜을 표준화했다고만 했고 구체적인 행동 과정이 부족함.

FEEDBACK: 연구실의 재현성 문제를 정확히 파악하고 설명한 부분은 좋았습니다. 하지만 프로토콜을 표준화하는 과정에서 어떤 구체적인 행동을 했는지에 대한 설명이 부족해요. 어떤 단계를 거쳐 표준화를 이루었는지, 어떤 어려움이 있었고 어떻게 해결했는지를 더 자세히 설명해 주시면 좋겠습니다.


## p1_q2
scores: situation=3, task_and_action=4, result=3  →  **strong = TASK_AND_ACTION / weak = RESULT**

### temp 0.3
- **direct**: GROUNDING: Strength (task/action) — 지원자는 온라인으로 공유되는 새 기록 시트를 만들고 기계 옆에 종이로 알림을 붙였으며 연구실 매니저에게 그룹 회의에서 언급해 달라고 부탁했다고 말함. Weakness (result) — "더 많은 사람이 기록을 적기 시작했고 시간이 좀 지나니 대부분 사용한 것 같다"고만 했고 구체적인 내용이 없음.

FEEDBACK: 온라인 기록 시트를 만들고 알림을 붙이는 등의 구체적인 행동을 통해 문제를 해결하려고 한 점은 매우 좋았습니다. 하지만 결과 부분이 조금 부족해요. "대부분 사용한 것 같다"는 표현만으로는 실제로 얼마나 개선되었는지 알기 어려워요. 기록을 적는 비율이 얼마나 증가했는지 같은 구체적인 수치가 필요합니다.


## p1_q3
scores: situation=3, task_and_action=3, result=2  →  **strong = SITUATION / weak = RESULT**

### temp 0.3
- **direct**: GROUNDING: Strength (situation) — 지원자는 중간고사, 실험 리포트 마감, 학과 행사 등 여러 가지 일을 동시에 처리해야 했던 상황을 구체적으로 설명함. Weakness (result) — "어떻게든 해냈다"와 "힘들긴 했다"라고만 했고 구체적인 결과가 없음.

FEEDBACK: 여러 가지 중요한 일을 동시에 처리해야 했던 상황을 잘 설명하셨어요. 하지만 결과 부분이 부족해요. "어떻게든 해냈다"라고만 하면 실제로 어떤 성과가 있었는지 알 수가 없어요. 각 작업이 어떻게 마무리되었는지, 예를 들어 리포트를 제시간에 제출했는지, 행사가 성공적으로 끝났는지 등의 구체적인 결과가 필요해요.


## p2_q1'
scores: situation=4, task_and_action=2, result=4  →  **strong = RESULT / weak = TASK_AND_ACTION**

### temp 0.3
- **direct**: GROUNDING: Strength (result) — 혼합 방식으로 진행하여 분석에 필요한 것보다 훨씬 많은 200개가 넘는 응답을 받았다고 말함. Weakness (task/action) — 의견 충돌을 어떻게 해결했는지 구체적인 행동이나 과정에 대한 설명이 부족함.

FEEDBACK: 혼합 방식으로 진행해서 200개가 넘는 응답을 받은 건 정말 인상적이에요. 하지만 의견 충돌을 해결하는 과정에서 어떤 구체적인 행동을 취했는지 설명이 부족했어요. 어떤 방법으로 팀원들과 의견 차이를 조율했는지, 구체적인 행동이나 전략을 더 자세히 설명해 주시면 좋겠습니다.


## p2_q1
scores: situation=3, task_and_action=2, result=2  →  **strong = SITUATION / weak = TASK_AND_ACTION**

### temp 0.3
- **direct**: GROUNDING: Strength (situation) — 지원자는 1학년 때 학생회에서 작은 축제를 준비하던 상황을 구체적으로 설명함. Weakness (task/action) — 자신의 의견을 말하긴 했지만 논쟁을 잘하지 못했고, 구체적으로 어떤 행동을 했는지에 대한 설명이 부족함.

FEEDBACK: 학생회에서 축제를 준비하던 상황을 구체적으로 설명하신 점은 좋았습니다. 하지만 의견 충돌을 해결하기 위해 어떤 구체적인 행동을 취했는지에 대한 설명이 부족했어요. 다음에는 어떤 방식으로 의견을 조율했는지, 구체적인 행동이나 전략을 더 자세히 설명해 주시면 좋겠습니다.


## p2_q2
scores: situation=3, task_and_action=3, result=2  →  **strong = SITUATION / weak = RESULT**

### temp 0.3
- **direct**: GROUNDING: Strength (situation) — 지원자는 기숙사에서 분리수거가 엉망인 상황을 설명함. Weakness (result) — "잘 됐는지는 확신이 없다"고 했고, 구체적인 결과에 대한 설명이 없음.

FEEDBACK: 기숙사에서 분리수거가 잘 안 되는 상황을 명확하게 설명한 점은 좋았어요. 하지만 결과가 부족해요. "잘 됐는지는 확신이 없다"고만 하면 실제로 어떤 변화가 있었는지 알 수가 없어요. 분리수거가 얼마나 개선되었는지, 구체적인 변화나 수치가 필요해요.


## p2_q3
scores: situation=3, task_and_action=2, result=2  →  **strong = SITUATION / weak = TASK_AND_ACTION**

### temp 0.3
- **direct**: GROUNDING: Strength (situation) — 지원자는 과제 두 개와 카페 아르바이트가 같은 주에 겹쳤다고 말함. Weakness (task/action) — "그냥 다 해보려고 했는데 하나는 좀 늦었다"며 구체적인 행동이나 전략이 부족함.

FEEDBACK: 여러 가지 일을 동시에 처리해야 했던 상황을 구체적으로 설명해 주신 점은 좋았습니다. 하지만 그 상황에서 어떤 구체적인 행동을 취했는지가 부족합니다. 예를 들어, 우선순위를 어떻게 정했는지, 시간을 어떻게 관리했는지에 대한 구체적인 설명이 필요합니다.


## p3_q1
scores: situation=4, task_and_action=5, result=5  →  **strong = RESULT / weak = SITUATION**

### temp 0.3
- **direct**: GROUNDING: Strength (result) — 지원자는 자신의 제안이 성공적이었고 해커톤에서 2등을 했다고 말함. Weakness (situation) — 팀이 작은 앱을 만들고 있었다고 했지만, 해커톤의 구체적인 상황이나 팀의 목표에 대한 설명이 부족함.

FEEDBACK: 해커톤에서 2등을 한 결과는 정말 인상적이에요. 하지만 상황 설명이 조금 더 구체적이면 좋겠어요. 해커톤의 주제나 팀의 목표가 무엇이었는지, 어떤 도전 과제가 있었는지 등을 추가하면 답변이 더 완성도 있게 들릴 거예요.


## p3_q2'
scores: situation=3, task_and_action=4, result=4  →  **strong = RESULT / weak = SITUATION**

### temp 0.3
- **direct**: GROUNDING: Strength (result) — 연구실을 위한 자동 백업 시스템을 구축한 후 4개월 동안 문제없이 운영되었고 파일을 잃은 적이 없다고 말함. Weakness (situation) — "그냥 해야 할 일 같아서 했습니다"라고만 했고 구체적인 상황 설명이 부족함.

FEEDBACK: 자동 백업 시스템을 성공적으로 구축하고 4개월 동안 문제없이 운영된 것은 정말 훌륭한 결과입니다. 다만, 왜 이 시스템을 구축하게 되었는지, 즉 초기 상황에 대한 설명이 부족해요. 어떤 문제나 필요가 있었는지 구체적으로 설명해주시면 좋겠습니다.


## p3_q2
scores: situation=3, task_and_action=4, result=3  →  **strong = TASK_AND_ACTION / weak = SITUATION**

### temp 0.3
- **direct**: GROUNDING: Strength (task/action) — 지원자는 노션에 마감과 담당을 정리한 공유 작업 보드를 만들고, 이를 업데이트하며 팀원들에게 리마인드했다고 말함. Weakness (situation) — 조별 과제에서 누가 무엇을 하는지 모르는 상황이었지만, 구체적인 상황 설명이 부족함.

FEEDBACK: 팀을 위해 노션 작업 보드를 만들어 체계적으로 관리한 점은 정말 잘하셨어요. 하지만 상황 설명이 조금 부족했어요. 어떤 과제였고, 팀의 규모나 구성은 어땠는지 같은 구체적인 배경 설명이 있으면 더 좋을 것 같아요.


## p3_q3
scores: situation=3, task_and_action=4, result=2  →  **strong = TASK_AND_ACTION / weak = RESULT**

### temp 0.3
- **direct**: GROUNDING: Strength (task/action) — 지원자는 한 주를 시간 단위로 블록을 나누고, 연구에는 고정된 시간을 배정하며, 조교 일은 몰아서 한 번에 처리한다고 말함. Weakness (result) — "지금까지는 그럭저럭 따라가고 있고 아직 크게 터진 건 없습니다"라고만 했고 구체적인 결과가 없음.

FEEDBACK: 여러 가지 일을 체계적으로 관리하기 위해 시간을 블록으로 나누고 우선순위를 정해 처리한 방식은 매우 효과적이에요. 하지만 결과 부분이 부족해요. "그럭저럭 따라가고 있다"는 표현만으로는 실제로 어떤 성과가 있었는지 알 수 없어요. 구체적으로 어떤 목표를 달성했는지, 예를 들어 프로젝트의 진행 상황이나 수업에서의 성과 등을 명확히 설명해 주세요.


## p4_q1'
scores: situation=2, task_and_action=1, result=3  →  **strong = RESULT / weak = TASK_AND_ACTION**

### temp 0.3
- **direct**: GROUNDING: Strength (result) — 조별 과제에서 의견 충돌을 해결하고 최고 학점을 받았다고 말함. Weakness (task/action) — 의견 충돌을 어떻게 해결했는지에 대한 구체적인 행동이 없음.

FEEDBACK: 의견 충돌을 잘 해결해서 최고 학점을 받은 건 훌륭한 결과입니다. 하지만 의견 충돌을 어떻게 해결했는지에 대한 구체적인 행동이 전혀 없었어요. 어떤 방법이나 전략을 사용했는지, 구체적인 행동을 설명해 주셔야 합니다.


## p4_q1
scores: situation=3, task_and_action=3, result=2  →  **strong = SITUATION / weak = RESULT**

### temp 0.3
- **direct**: GROUNDING: Strength (situation) — 지원자는 네 명의 팀원이 재생에너지와 인공지능 주제를 두고 의견 충돌이 있었다고 말함. Weakness (result) — 예시 논문을 보내고 투표를 했다고만 했고 구체적인 결과가 없음.

FEEDBACK: 팀원들 간의 의견 충돌 상황을 명확하게 설명하신 점은 좋았습니다. 하지만 결과 부분이 부족해요. 예시 논문을 보내고 투표를 했다고만 하면 실제로 어떤 결과가 나왔는지 알 수가 없어요. 최종적으로 어떤 주제를 선택했는지, 그 선택이 팀 프로젝트에 어떤 영향을 미쳤는지 구체적으로 설명해 주세요.


## p4_q2
scores: situation=2, task_and_action=1, result=3  →  **strong = RESULT / weak = TASK_AND_ACTION**

### temp 0.3
- **direct**: GROUNDING: Strength (result) — 공유 드라이브가 생겨서 사람들이 많이 쓰고 유용하다고 말함. Weakness (task/action) — 기출 시험지를 정리하고 공유 드라이브를 만든 과정에 대한 설명이 없음.

FEEDBACK: 공유 드라이브가 생겨서 많은 사람들이 유용하게 사용하고 있다는 결과는 잘 설명하셨어요. 하지만 기출 시험지를 어떻게 정리했고, 공유 드라이브를 만드는 과정에서 어떤 행동을 했는지가 전혀 언급되지 않았습니다. 어떤 계획을 세웠고, 구체적으로 어떤 행동을 했는지를 더 자세히 설명해 주세요.


## p4_q3'
scores: situation=2, task_and_action=3, result=3  →  **strong = RESULT / weak = SITUATION**

### temp 0.3
- **direct**: GROUNDING: Strength (result) — 지원자는 모든 일을 제때 끝냈고 늦은 것은 하나도 없었다고 말함. Weakness (situation) — 바쁜 주였다고만 했고 구체적인 상황 설명이 부족함.

FEEDBACK: 모든 일을 제때 끝내고 늦은 것이 없었다는 결과는 잘 전달하셨어요. 하지만 상황 설명이 부족합니다. 바쁜 주라고만 하면 어떤 종류의 일들이 있었는지, 왜 바빴는지 알기 어렵습니다. 구체적으로 어떤 일들이 있었고, 왜 여러 가지 일을 동시에 처리해야 했는지 설명이 필요해요.


## p4_q3
scores: situation=4, task_and_action=1, result=1  →  **strong = SITUATION / weak = TASK_AND_ACTION**

### temp 0.3
- **direct**: GROUNDING: Strength (situation) — 후보자는 프로젝트 발표, 오픈북 시험, 아르바이트 일정이 겹쳤던 주에 대해 구체적으로 설명함. Weakness (task/action) — 후보자가 이 상황에서 구체적으로 어떤 행동을 했는지에 대한 설명이 없음.

FEEDBACK: 여러 가지 일이 몰려 있었던 상황을 잘 설명하셨어요. 하지만 그 상황에서 어떻게 일을 처리했는지 구체적인 행동이 빠져 있어요. 어떤 전략을 사용했는지, 우선순위를 어떻게 정했는지 등을 설명해 주시면 좋겠습니다.