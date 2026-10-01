module github.com/terra-project/terra/module/common/io.terra.agent

go 1.24.0

replace github.com/terra-project/terra/products/common/packages/terra-module-sdk => ../../../../products/common/packages/terra-module-sdk

replace github.com/terra-project/terra/products/common/packages/terra-module-runtime => ../../../../products/common/packages/terra-module-runtime

replace github.com/terra-project/terra/products/common/packages/terra-protocol => ../../../../products/common/packages/terra-protocol

replace github.com/terra-project/terra/products/common/packages/terra-svi => ../../../../products/common/packages/terra-svi

replace github.com/terra-project/terra/products/common/packages/terra-agent-core => ../../../../products/common/packages/terra-agent-core

replace github.com/terra-project/terra/products/common/packages/terra-api-contract => ../../../../products/common/packages/terra-api-contract

require (
	github.com/anthropics/anthropic-sdk-go v1.71.0
	github.com/terra-project/terra/products/common/packages/terra-agent-core v0.0.0
	github.com/terra-project/terra/products/common/packages/terra-module-runtime v0.0.0
	github.com/terra-project/terra/products/common/packages/terra-module-sdk v0.0.0
)

require (
	github.com/bahlo/generic-list-go v0.2.0 // indirect
	github.com/buger/jsonparser v1.1.2 // indirect
	github.com/dlclark/regexp2 v1.11.0 // indirect
	github.com/invopop/jsonschema v0.14.0 // indirect
	github.com/pb33f/ordered-map/v2 v2.3.1 // indirect
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.2 // indirect
	github.com/standard-webhooks/standard-webhooks/libraries v0.0.1 // indirect
	github.com/terra-project/terra/products/common/packages/terra-api-contract v0.0.0 // indirect
	github.com/terra-project/terra/products/common/packages/terra-svi v0.0.0 // indirect
	github.com/tidwall/gjson v1.18.0 // indirect
	github.com/tidwall/match v1.1.1 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/tidwall/sjson v1.2.5 // indirect
	go.yaml.in/yaml/v4 v4.0.0-rc.2 // indirect
	golang.org/x/sync v0.16.0 // indirect
	golang.org/x/text v0.27.0 // indirect
	github.com/terra-project/terra/products/common/packages/terra-testwait v0.0.0
)

replace github.com/terra-project/terra/products/common/packages/terra-testwait => ../../../../products/common/packages/terra-testwait
