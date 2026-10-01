module github.com/terra-project/terra/module/common/io.terra.webapp-host

go 1.23.0

replace github.com/terra-project/terra/products/common/packages/terra-module-sdk => ../../../../products/common/packages/terra-module-sdk

replace github.com/terra-project/terra/products/common/packages/terra-module-runtime => ../../../../products/common/packages/terra-module-runtime

replace github.com/terra-project/terra/products/common/packages/terra-protocol => ../../../../products/common/packages/terra-protocol

replace github.com/terra-project/terra/products/common/packages/terra-svi => ../../../../products/common/packages/terra-svi

require github.com/terra-project/terra/products/common/packages/terra-module-sdk v0.0.0-00010101000000-000000000000

require (
	github.com/terra-project/terra/products/common/packages/terra-module-runtime v0.0.0 // indirect
	github.com/terra-project/terra/products/common/packages/terra-svi v0.0.0 // indirect
)
